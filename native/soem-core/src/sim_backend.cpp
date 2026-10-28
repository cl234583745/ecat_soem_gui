#include "ecat_core/sim_backend.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include <sstream>
#include <utility>

namespace ecat {
namespace {

constexpr std::size_t kHistoryLimit = 90;

std::string uppercase_hex(std::uint32_t value, int width) {
  std::ostringstream stream;
  stream << std::uppercase << std::hex;
  if (width == 2) {
    stream << static_cast<int>(value & 0xff);
  } else if (width == 4) {
    stream << static_cast<int>(value & 0xffff);
  } else {
    stream << value;
  }
  auto result = stream.str();
  if (result.size() < static_cast<std::size_t>(width)) {
    result.insert(0, static_cast<std::size_t>(width) - result.size(), '0');
  }
  return result;
}

std::string state_code(const std::string& state) {
  if (state == "INIT") {
    return "0x0001";
  }
  if (state == "PRE-OP") {
    return "0x0002";
  }
  if (state == "SAFE-OP") {
    return "0x0004";
  }
  return "0x0008";
}

std::int64_t unix_millis() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

Json distribution_summary(int base_us, std::uint64_t sample_count) {
  const auto phase = static_cast<double>(sample_count % 101);
  const auto wave =
      static_cast<int>(std::round(std::sin(phase / 7.0) * 3.0));
  return {{"meanUs", static_cast<double>(base_us + 1)},
          {"p50Us", std::max(0, base_us - 1)},
          {"p95Us", base_us + 2 + std::max(0, wave)},
          {"p99Us", base_us + 8 + std::max(0, wave)},
          {"p999Us", base_us + 25 + std::max(0, wave)},
          {"maxUs", base_us + 80 + std::max(0, wave)}};
}

Json empty_benchmark() {
  const auto distribution =
      Json{{"meanUs", 0.0},
           {"p50Us", 0},
           {"p95Us", 0},
           {"p99Us", 0},
           {"p999Us", 0},
           {"maxUs", 0}};
  return {{"status", "idle"},
          {"durationSec", 0},
          {"elapsedSec", 0.0},
          {"samples", 0},
          {"cycleTime", distribution},
          {"ioDuration", distribution},
          {"scheduleJitter", distribution},
          {"over1050", 0},
          {"over1200", 0},
          {"over2000", 0},
          {"lostFrames", 0},
          {"wkcErrors", 0},
          {"startedAt", 0},
          {"completedAt", 0}};
}

std::string bytes_to_hex(const std::vector<std::uint8_t>& bytes) {
  std::ostringstream stream;
  stream << std::uppercase << std::hex;
  for (const auto byte : bytes) {
    stream.width(2);
    stream.fill('0');
    stream << static_cast<int>(byte);
  }
  return stream.str();
}

}  // namespace

SimBackend::SimBackend()
    : adapters_(Json::array(
          {{{"id", "sim:intel-i219"},
            {"name", "Intel I219-LM"},
            {"description", "Simulated dedicated EtherCAT adapter"},
            {"mac", "3C:7C:3F:8A:21:10"},
            {"linkUp", true},
            {"driver", "SIM / NPF"},
            {"dedicated", true}},
           {{"id", "sim:realtek-usb"},
            {"name", "Realtek USB GbE"},
            {"description", "Simulated USB EtherCAT adapter"},
            {"mac", "00:E0:4C:68:42:7B"},
            {"linkUp", false},
            {"driver", "SIM / NPF"},
            {"dedicated", true}}})) {
  std::scoped_lock lock(mutex_);
  benchmark_ = empty_benchmark();
  config_ = {{"adapterId", adapter_id_},
             {"cycleUs", cycle_us_},
             {"sendTimeoutUs", 2000},
             {"receiveTimeoutUs", 2000},
             {"autoTransitionOp", auto_transition_op_},
             {"distributedClock", true},
             {"realtimePriority", true},
             {"dedicatedCore", 2},
             {"eniPath", ""},
             {"logToDisk", true},
             {"retainFrames", 5000}};
  add_log_locked("info", "CORE", "Native simulator core initialized");
}

std::string SimBackend::mode() const { return "simulator"; }

Json SimBackend::capabilities() const {
  return {{"hardware", false},
          {"eniImport", false},
          {"eoe", true},
          {"foe", true},
          {"realtimeBenchmark", true},
          {"native", true}};
}

Json SimBackend::snapshot() {
  std::scoped_lock lock(mutex_);
  refresh_locked();
  config_["adapterId"] = adapter_id_;
  config_["cycleUs"] = cycle_us_;
  config_["autoTransitionOp"] = auto_transition_op_;

  const auto expected_wkc =
      slaves_.empty() ? 0 : static_cast<int>(slaves_.size()) + 1;
  const auto wkc = phase_ == "op" ? expected_wkc : 0;
  const auto uptime =
      connected_
          ? std::chrono::duration_cast<std::chrono::seconds>(Clock::now() -
                                                            started_at_)
                .count()
          : 0;
  const auto latest =
      history_.empty()
          ? Json{{"at", unix_millis()},
                 {"cycleUs", 0},
                 {"jitterUs", 0},
                 {"wkc", 0},
                 {"expectedWkc", expected_wkc},
                 {"lostFrames", lost_frames_},
                 {"dcOffsetNs", 0}}
          : history_.back();

  return {{"version", ECAT_CORE_VERSION},
          {"mode", mode()},
          {"phase", phase_},
          {"connected", connected_},
          {"scanning", scanning_},
          {"adapters", adapters_},
          {"selectedAdapterId", adapter_id_},
          {"slaves", slaves_},
          {"selectedSlaveIndex", selected_slave_index_},
          {"telemetry", latest},
          {"history", history_},
          {"counters",
           {{"cycles", cycles_},
            {"lostFrames", lost_frames_},
            {"mailboxErrors", mailbox_errors_},
            {"workingCounterErrors", 0},
            {"uptimeSec", uptime}}},
          {"logs", logs_},
          {"transfer",
           {{"active", false},
            {"direction", "download"},
            {"fileName", ""},
            {"progress", 0},
            {"progressAvailable", false},
            {"bytesCompleted", 0},
            {"bytesTotal", 0},
            {"status", "idle"},
            {"message", "Waiting for FoE task"}}},
          {"benchmark", benchmark_},
          {"config", config_},
          {"capabilities", capabilities()},
          {"wkc", wkc},
          {"expectedWkc", expected_wkc}};
}

Json SimBackend::list_adapters() {
  std::scoped_lock lock(mutex_);
  return adapters_;
}

BackendResult SimBackend::select_adapter(const std::string& adapter_id) {
  std::scoped_lock lock(mutex_);
  if (connected_) {
    return BackendResult::failure("Stop the bus before changing adapters");
  }
  const auto found = std::any_of(
      adapters_.begin(), adapters_.end(), [&adapter_id](const Json& adapter) {
        return adapter.value("id", "") == adapter_id;
      });
  if (!found) {
    return BackendResult::failure("Adapter was not found");
  }
  adapter_id_ = adapter_id;
  config_["adapterId"] = adapter_id;
  add_log_locked("info", "ADAPTER", "Selected simulator adapter " + adapter_id);
  return BackendResult::success("Adapter selected");
}

BackendResult SimBackend::select_slave(int slave_index) {
  std::scoped_lock lock(mutex_);
  if (!has_slave_locked(slave_index)) {
    return BackendResult::failure("Slave does not exist");
  }
  selected_slave_index_ = slave_index;
  return BackendResult::success("Slave selected");
}

BackendResult SimBackend::update_config(const Json& config) {
  std::scoped_lock lock(mutex_);
  if (auto guard = benchmark_guard_locked("changing configuration")) {
    return *guard;
  }
  if (!config.is_object()) {
    return BackendResult::failure("Configuration must be a JSON object");
  }
  auto next = config_;
  next.update(config);
  if (next.contains("adapterId") && !next["adapterId"].is_string()) {
    return BackendResult::failure("adapterId must be a string");
  }
  const auto requested_adapter = next.value("adapterId", adapter_id_);
  if (requested_adapter != adapter_id_) {
    if (connected_) {
      return BackendResult::failure("Stop the bus before changing adapters");
    }
    const auto found =
        std::any_of(adapters_.begin(), adapters_.end(),
                    [&requested_adapter](const Json& adapter) {
                      return adapter.value("id", "") == requested_adapter;
                    });
    if (!found) {
      return BackendResult::failure("Adapter was not found");
    }
    adapter_id_ = requested_adapter;
  }
  cycle_us_ = std::clamp(next.value("cycleUs", cycle_us_), 250, 10000);
  next["cycleUs"] = cycle_us_;
  next["sendTimeoutUs"] = std::clamp(
      next.value("sendTimeoutUs", 2000), cycle_us_, 100000);
  next["receiveTimeoutUs"] = std::clamp(
      next.value("receiveTimeoutUs", 2000), cycle_us_, 100000);
  next["dedicatedCore"] =
      std::clamp(next.value("dedicatedCore", 2), 0, 63);
  next["retainFrames"] =
      std::clamp(next.value("retainFrames", 5000), 100, 100000);
  auto_transition_op_ = next.value("autoTransitionOp", auto_transition_op_);
  config_ = std::move(next);
  add_log_locked("info", "CONFIG",
                 "Configuration applied at " +
                     std::to_string(config_.value("cycleUs", 1000)) + " us");
  return BackendResult::success("Configuration applied");
}

BackendResult SimBackend::clear_logs() {
  std::scoped_lock lock(mutex_);
  logs_ = Json::array();
  return BackendResult::success("Logs cleared");
}

BackendResult SimBackend::load_eni(const std::string& file_path) {
  std::scoped_lock lock(mutex_);
  if (auto guard = benchmark_guard_locked("loading an ENI file")) {
    return *guard;
  }
  if (file_path.empty()) {
    return BackendResult::failure("ENI file path is empty");
  }
  std::error_code error;
  if (!std::filesystem::is_regular_file(file_path, error) ||
      std::filesystem::file_size(file_path, error) == 0) {
    return BackendResult::failure("ENI file does not exist or is empty");
  }
  config_["eniPath"] = file_path;
  add_log_locked("info", "ENI",
                 "Registered ENI file " + file_path +
                     "; simulator uses built-in process data");
  return BackendResult::success(
      "ENI file registered; simulator keeps its built-in PDO mapping",
      {{"path", file_path}, {"mappingApplied", false}});
}

BackendResult SimBackend::start(const std::string& adapter_id,
                                int cycle_us,
                                bool auto_transition_op) {
  std::scoped_lock lock(mutex_);
  if (connected_) {
    return BackendResult::failure("Bus is already running");
  }
  adapter_id_ = adapter_id.empty() ? "sim:intel-i219" : adapter_id;
  cycle_us_ = std::clamp(cycle_us, 250, 10000);
  auto_transition_op_ = auto_transition_op;
  config_["adapterId"] = adapter_id_;
  config_["cycleUs"] = cycle_us_;
  config_["autoTransitionOp"] = auto_transition_op_;
  connected_ = true;
  phase_ = "preop";
  started_at_ = Clock::now();
  cycles_ = 0;
  lost_frames_ = 0;
  add_log_locked("info", "MASTER", "Simulated master initialized in PRE-OP");
  return BackendResult::success("Bus started");
}

BackendResult SimBackend::stop() {
  std::scoped_lock lock(mutex_);
  if (benchmark_status_ == "running") {
    benchmark_status_ = "aborted";
    benchmark_["status"] = "aborted";
    benchmark_["completedAt"] = unix_millis();
    add_log_locked("warning", "RT",
                   "Simulated realtime benchmark aborted by bus stop");
  }
  connected_ = false;
  scanning_ = false;
  phase_ = "offline";
  slaves_ = Json::array();
  selected_slave_index_ = 0;
  add_log_locked("warning", "MASTER", "Bus stopped and adapter released");
  return BackendResult::success("Bus stopped");
}

BackendResult SimBackend::scan() {
  std::scoped_lock lock(mutex_);
  if (auto guard = benchmark_guard_locked("scanning")) {
    return *guard;
  }
  if (!connected_) {
    return BackendResult::failure("Bus is not started");
  }
  scanning_ = true;
  create_demo_slaves_locked();
  scanning_ = false;
  phase_ = "preop";
  add_log_locked("success", "SCAN",
                 "Scan complete: 4 simulated slaves found");
  if (auto_transition_op_) {
    std::string failure;
    if (!transition_all_locked("OP", failure)) {
      return BackendResult::failure(failure);
    }
  }
  return BackendResult::success(
      "Scan complete", {{"count", static_cast<int>(slaves_.size())}});
}

BackendResult SimBackend::transition(int slave_index,
                                     const std::string& target) {
  std::scoped_lock lock(mutex_);
  if (auto guard = benchmark_guard_locked("changing slave states")) {
    return *guard;
  }
  if (!connected_) {
    return BackendResult::failure("Bus is not started");
  }
  if (!has_slave_locked(slave_index)) {
    return BackendResult::failure("Slave does not exist");
  }
  if (target != "INIT" && target != "PRE-OP" && target != "SAFE-OP" &&
      target != "OP") {
    return BackendResult::failure("Invalid EtherCAT state");
  }
  for (auto& slave : slaves_) {
    if (slave.value("index", 0) == slave_index) {
      slave["state"] = target;
      slave["alStatus"] = state_code(target);
      slave["alStatusCode"] = target;
      break;
    }
  }
  phase_ = aggregate_phase_locked();
  add_log_locked("info", "SLAVE " + std::to_string(slave_index),
                 "State transition to " + target);
  return BackendResult::success("Slave state changed");
}

BackendResult SimBackend::transition_all(const std::string& target) {
  std::scoped_lock lock(mutex_);
  if (auto guard = benchmark_guard_locked("changing slave states")) {
    return *guard;
  }
  if (!connected_) {
    return BackendResult::failure("Bus is not started");
  }
  std::string failure;
  if (!transition_all_locked(target, failure)) {
    return BackendResult::failure(failure);
  }
  return BackendResult::success("All slaves changed state");
}

BackendResult SimBackend::sdo_read(int slave_index,
                                   std::uint16_t index,
                                   std::uint8_t sub_index,
                                   bool /*complete_access*/) {
  std::scoped_lock lock(mutex_);
  if (auto guard = benchmark_guard_locked("running SDO")) {
    return *guard;
  }
  if (!has_slave_locked(slave_index)) {
    return BackendResult::failure("Slave does not exist");
  }
  std::string value = "00000000";
  if (index == 0x6041 && sub_index == 0) {
    value = "0237";
  } else if (index == 0x6040 && sub_index == 0) {
    value = "000F";
  } else if (index == 0x6064 && sub_index == 0) {
    value = "000F4240";
  } else if (index == 0x2000 && sub_index == 0) {
    value = "00001234";
  }
  add_log_locked("success", "SDO",
                 "Read 0x" + uppercase_hex(index, 4) + ":" +
                     uppercase_hex(sub_index, 2) + " = 0x" + value);
  return BackendResult::success(
      "SDO upload complete",
      {{"valueHex", value},
       {"valueDecimal", std::to_string(std::stoul(value, nullptr, 16))},
       {"elapsedUs", 360}});
}

BackendResult SimBackend::sdo_write(
    int slave_index,
    std::uint16_t index,
    std::uint8_t sub_index,
    const std::vector<std::uint8_t>& payload,
    bool /*complete_access*/) {
  std::scoped_lock lock(mutex_);
  if (auto guard = benchmark_guard_locked("running SDO")) {
    return *guard;
  }
  if (!has_slave_locked(slave_index)) {
    return BackendResult::failure("Slave does not exist");
  }
  if (payload.empty()) {
    return BackendResult::failure("SDO payload is empty");
  }
  add_log_locked("success", "SDO",
                 "Wrote 0x" + uppercase_hex(index, 4) + ":" +
                     uppercase_hex(sub_index, 2) + " <- 0x" +
                     bytes_to_hex(payload));
  return BackendResult::success(
      "SDO download complete",
      {{"valueHex", bytes_to_hex(payload)},
       {"valueDecimal", std::to_string(payload.back())},
       {"elapsedUs", 410}});
}

BackendResult SimBackend::write_pdo(int slave_index,
                                    std::uint16_t index,
                                    std::uint8_t sub_index,
                                    const std::string& value) {
  std::scoped_lock lock(mutex_);
  if (auto guard = benchmark_guard_locked("writing PDO")) {
    return *guard;
  }
  if (phase_ != "op") {
    return BackendResult::failure("PDO writes require OP state");
  }
  for (auto& slave : slaves_) {
    if (slave.value("index", 0) != slave_index) {
      continue;
    }
    for (auto& output : slave["outputs"]) {
      if (output.value("index", "") == "0x" + uppercase_hex(index, 4) &&
          output.value("subIndex", 0) == sub_index) {
        output["value"] = value;
        add_log_locked("info", "PDO", "Process image output updated");
        return BackendResult::success("PDO output updated");
      }
    }
  }
  return BackendResult::failure("PDO output was not found");
}

BackendResult SimBackend::mailbox(
    int slave_index,
    const std::string& protocol,
    const std::vector<std::uint8_t>& payload) {
  std::scoped_lock lock(mutex_);
  if (auto guard = benchmark_guard_locked("running mailbox operations")) {
    return *guard;
  }
  if (!has_slave_locked(slave_index)) {
    return BackendResult::failure("Slave does not exist");
  }
  if (payload.empty()) {
    return BackendResult::failure("Mailbox payload is empty");
  }
  auto response = bytes_to_hex(payload);
  response += "0A00";
  add_log_locked("success", "MAILBOX",
                 protocol + " transaction completed");
  return BackendResult::success(
      "Mailbox response received",
      {{"responseHex", response}, {"elapsedUs", 480}});
}

BackendResult SimBackend::foe_start(const std::string& direction,
                                    const std::string& /*file_path*/,
                                    const std::string& file_name,
                                    std::uint32_t /*password*/) {
  std::scoped_lock lock(mutex_);
  if (auto guard = benchmark_guard_locked("starting FoE")) {
    return *guard;
  }
  if (!connected_) {
    return BackendResult::failure("Bus is not started");
  }
  add_log_locked("info", "FoE",
                 "Started " + direction + " for " + file_name);
  return BackendResult::success("FoE task started");
}

BackendResult SimBackend::foe_cancel() {
  std::scoped_lock lock(mutex_);
  add_log_locked("warning", "FoE", "FoE task cancelled");
  return BackendResult::success("FoE task cancelled");
}

BackendResult SimBackend::benchmark_start(int duration_sec) {
  std::scoped_lock lock(mutex_);
  if (!connected_ || phase_ != "op") {
    return BackendResult::failure(
        "Realtime benchmark requires an active simulated OP cycle");
  }
  if (benchmark_status_ == "running") {
    return BackendResult::failure("A realtime benchmark is already running");
  }
  if (duration_sec < 1 || duration_sec > 8 * 60 * 60) {
    return BackendResult::failure(
        "Simulator benchmark duration must be between 1 second and 8 hours");
  }
  benchmark_status_ = "running";
  benchmark_duration_sec_ = duration_sec;
  benchmark_started_at_ = Clock::now();
  benchmark_started_at_unix_ms_ = unix_millis();
  benchmark_ = {
      {"status", "running"},
      {"durationSec", duration_sec},
      {"elapsedSec", 0.0},
      {"samples", 0},
      {"cycleTime", distribution_summary(cycle_us_, 0)},
      {"ioDuration", distribution_summary(std::max(1, cycle_us_ / 3), 0)},
      {"scheduleJitter", distribution_summary(6, 0)},
      {"over1050", 0},
      {"over1200", 0},
      {"over2000", 0},
      {"lostFrames", 0},
      {"wkcErrors", 0},
      {"startedAt", benchmark_started_at_unix_ms_},
      {"completedAt", 0},
      {"simulated", true}};
  add_log_locked(
      "info", "RT",
      "Simulated realtime benchmark started for " +
          std::to_string(duration_sec) + " seconds");
  return BackendResult::success(
      "Simulated realtime benchmark started",
      {{"durationSec", duration_sec}, {"cycleUs", cycle_us_}});
}

BackendResult SimBackend::benchmark_stop() {
  std::scoped_lock lock(mutex_);
  if (benchmark_status_ != "running") {
    return BackendResult::failure("No realtime benchmark is running");
  }
  benchmark_status_ = "stopped";
  benchmark_["status"] = "stopped";
  benchmark_["completedAt"] = unix_millis();
  add_log_locked("info", "RT", "Simulated realtime benchmark stopped");
  return BackendResult::success("Realtime benchmark stopped");
}

void SimBackend::update_benchmark_locked() {
  if (benchmark_status_ != "running") {
    return;
  }
  const auto elapsed = Clock::now() - benchmark_started_at_;
  const auto elapsed_seconds = std::chrono::duration<double>(elapsed).count();
  const auto samples = static_cast<std::uint64_t>(
      elapsed_seconds * 1'000'000.0 / std::max(1, cycle_us_));
  const auto completed =
      elapsed_seconds >= static_cast<double>(benchmark_duration_sec_);
  const auto synthetic_cycle = distribution_summary(cycle_us_, samples);
  auto synthetic_jitter = distribution_summary(
      std::max(1, cycle_us_ / 100), samples);
  synthetic_jitter["p50Us"] = 4;
  synthetic_jitter["p95Us"] = 8;
  synthetic_jitter["p99Us"] = 13;
  synthetic_jitter["p999Us"] = 28;
  synthetic_jitter["maxUs"] = 74;
  benchmark_ = {
      {"status", completed ? "completed" : "running"},
      {"durationSec", benchmark_duration_sec_},
      {"elapsedSec", elapsed_seconds},
      {"samples", samples},
      {"cycleTime", synthetic_cycle},
      {"ioDuration",
       distribution_summary(std::max(1, cycle_us_ / 3), samples)},
      {"scheduleJitter", synthetic_jitter},
      {"over1050", cycle_us_ > 1050 ? samples : 0},
      {"over1200", cycle_us_ > 1200 ? samples : 0},
      {"over2000", cycle_us_ > 2000 ? samples : 0},
      {"lostFrames", 0},
      {"wkcErrors", 0},
      {"startedAt", benchmark_started_at_unix_ms_},
      {"completedAt", completed ? unix_millis() : 0},
      {"simulated", true}};
  if (completed) {
    benchmark_status_ = "completed";
    add_log_locked(
        "success", "RT",
        "Simulated realtime benchmark completed with " +
            std::to_string(samples) + " samples");
  }
}

void SimBackend::refresh_locked() {
  if (!connected_) {
    return;
  }
  const auto now = Clock::now();
  const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
                           now - last_sample_at_)
                           .count();
  if (elapsed < 50000) {
    return;
  }
  const auto new_cycles =
      static_cast<std::uint64_t>(std::max<std::int64_t>(
          1, elapsed * 1000 / std::max(1, cycle_us_)));
  cycles_ += new_cycles;
  last_sample_at_ = now;
  const auto wave =
      std::sin(static_cast<double>(cycles_) / 53.0) * 7.0 +
      std::cos(static_cast<double>(cycles_) / 131.0) * 4.0;
  const auto cycle_time = cycle_us_ + static_cast<int>(std::round(wave));
  const auto jitter = std::max(1, static_cast<int>(std::round(std::abs(wave))) + 5);
  const auto expected_wkc =
      slaves_.empty() ? 0 : static_cast<int>(slaves_.size()) + 1;
  const auto wkc = phase_ == "op" ? expected_wkc : 0;
  history_.push_back(Json{{"at", unix_millis()},
                          {"cycleUs", cycle_time},
                          {"jitterUs", jitter},
                          {"wkc", wkc},
                          {"expectedWkc", expected_wkc},
                          {"lostFrames", lost_frames_},
                          {"dcOffsetNs", 72}});
  while (history_.size() > kHistoryLimit) {
    history_.erase(history_.begin());
  }
  update_benchmark_locked();
}

std::optional<BackendResult> SimBackend::benchmark_guard_locked(
    std::string_view operation) const {
  if (benchmark_status_ != "running") {
    return std::nullopt;
  }
  return BackendResult::failure(
      "Stop the realtime benchmark before " + std::string(operation));
}

void SimBackend::add_log_locked(const std::string& level,
                                const std::string& source,
                                const std::string& message) {
  const Json entry = {{"id", "native-" + std::to_string(++log_counter_)},
                      {"at", unix_millis()},
                      {"level", level},
                      {"source", source},
                      {"message", message}};
  logs_.insert(logs_.begin(), entry);
  while (logs_.size() > 240) {
    logs_.erase(logs_.end() - 1);
  }
}

Json SimBackend::make_slave(
    int index,
    const std::string& name,
    const std::string& vendor_id,
    const std::string& product_code,
    const std::string& revision,
    const std::array<std::string, 2>& protocols) const {
  Json mailbox = Json::array();
  for (const auto& protocol : protocols) {
    if (!protocol.empty()) {
      mailbox.push_back(protocol);
    }
  }
  const bool servo = index == 1;
  Json outputs = Json::array();
  Json inputs = Json::array();
  if (servo) {
    outputs.push_back({{"index", "0x6040"},
                       {"subIndex", 0},
                       {"name", "Controlword"},
                       {"type", "UINT16"},
                       {"value", "0x000F"},
                       {"writable", true}});
    inputs.push_back({{"index", "0x6041"},
                      {"subIndex", 0},
                      {"name", "Statusword"},
                      {"type", "UINT16"},
                      {"value", "0x0237"},
                      {"writable", false}});
  } else {
    outputs.push_back({{"index", "0x7000"},
                       {"subIndex", 1},
                       {"name", "Digital output"},
                       {"type", "BYTE"},
                       {"value", "0x3C"},
                       {"writable", true}});
    inputs.push_back({{"index", "0x6000"},
                      {"subIndex", 1},
                      {"name", "Input value"},
                      {"type", "UINT16"},
                      {"value", "0x00A5"},
                      {"writable", false}});
  }
  return {{"index", index},
          {"name", name},
          {"vendorId", vendor_id},
          {"productCode", product_code},
          {"revision", revision},
          {"serial", "SIM-NATIVE-" + std::to_string(index)},
          {"state", "PRE-OP"},
          {"alStatus", 0x0002},
          {"alStatusCode", "PRE-OP"},
          {"wkc", 3},
          {"dcEnabled", true},
          {"mailboxProtocols", mailbox},
          {"inputs", inputs},
          {"outputs", outputs}};
}

void SimBackend::create_demo_slaves_locked() {
  slaves_ = Json::array(
      {make_slave(1, "AM8121 Servo", "0x0000066F", "0x0000A812", "0x01000003",
                  {"CoE", "FoE"}),
       make_slave(2, "EC8-DIO Remote I/O", "0x00000ACE", "0x00001008",
                  "0x00020001", {"CoE", "FoE"}),
       make_slave(3, "ABS-24 Encoder", "0x00000A77", "0x00002401",
                  "0x00010006", {"CoE", ""}),
       make_slave(4, "GW-EC Gateway", "0x00000B12", "0x00000120",
                  "0x00030000", {"CoE", "EoE"})});
  selected_slave_index_ = 1;
}

bool SimBackend::has_slave_locked(int index) const {
  return std::any_of(slaves_.begin(), slaves_.end(), [index](const Json& slave) {
    return slave.value("index", 0) == index;
  });
}

std::string SimBackend::aggregate_phase_locked() const {
  if (!connected_) {
    return "offline";
  }
  if (slaves_.empty()) {
    return "preop";
  }
  int lowest = 3;
  for (const auto& slave : slaves_) {
    const auto state = slave.value("state", "INIT");
    int rank = 0;
    if (state == "PRE-OP") {
      rank = 1;
    } else if (state == "SAFE-OP") {
      rank = 2;
    } else if (state == "OP") {
      rank = 3;
    }
    lowest = std::min(lowest, rank);
  }
  if (lowest == 3) {
    return "op";
  }
  if (lowest == 2) {
    return "safeop";
  }
  return "preop";
}

bool SimBackend::transition_all_locked(const std::string& target,
                                       std::string& failure_message) {
  if (slaves_.empty()) {
    failure_message = "No slaves discovered";
    return false;
  }
  if (target != "INIT" && target != "PRE-OP" && target != "SAFE-OP" &&
      target != "OP") {
    failure_message = "Invalid EtherCAT state";
    return false;
  }
  for (auto& slave : slaves_) {
    slave["state"] = target;
    slave["alStatus"] = state_code(target);
    slave["alStatusCode"] = target;
  }
  phase_ = aggregate_phase_locked();
  add_log_locked("success", "MASTER",
                 "All slaves transitioned to " + target);
  return true;
}

}  // namespace ecat
