#include "ecat_core/soem_backend.hpp"

#ifdef ECAT_HAS_SOEM

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cmath>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iterator>
#include <limits>
#include <map>
#include <sstream>

#include <soem/soem.h>

#ifdef _WIN32
#include <iphlpapi.h>
#include <pcap.h>
#include <windows.h>
#include <mmsystem.h>
#endif

namespace ecat {

struct SoemBackend::SoemContext {
  ecx_contextt context{};
};

namespace {

constexpr int kMailboxTimeout = 5000;
constexpr std::size_t kSdoBufferBytes = 4096;
constexpr std::size_t kMaximumFoeBytes = 64U * 1024U * 1024U;
constexpr std::size_t kHistoryLimit = 90;
constexpr std::uint32_t kRawPdoByteLimit = 256;
constexpr int kMailboxStepsPerCycle = 4;

class AtomicCounterGuard {
 public:
  AtomicCounterGuard(std::atomic<int>& counter, bool enabled)
      : counter_(enabled ? &counter : nullptr) {
    if (counter_ != nullptr) {
      counter_->fetch_add(1, std::memory_order_release);
    }
  }

  ~AtomicCounterGuard() {
    if (counter_ != nullptr) {
      counter_->fetch_sub(1, std::memory_order_release);
    }
  }

  AtomicCounterGuard(const AtomicCounterGuard&) = delete;
  AtomicCounterGuard& operator=(const AtomicCounterGuard&) = delete;

 private:
  std::atomic<int>* counter_;
};

std::int64_t unix_millis() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::system_clock::now().time_since_epoch())
      .count();
}

std::string hex_value(std::uint32_t value, int width) {
  std::ostringstream stream;
  stream << "0x" << std::uppercase << std::hex << std::setw(width)
         << std::setfill('0') << value;
  return stream.str();
}

std::string bytes_to_hex(const std::vector<std::uint8_t>& bytes) {
  std::ostringstream stream;
  stream << std::uppercase << std::hex;
  for (const auto byte : bytes) {
    stream << std::setw(2) << std::setfill('0') << static_cast<int>(byte);
  }
  return stream.str();
}

std::string bytes_to_decimal(const std::vector<std::uint8_t>& bytes) {
  if (bytes.empty() || bytes.size() > sizeof(std::uint64_t)) {
    return "n/a";
  }
  std::uint64_t value = 0;
  for (std::size_t index = 0; index < bytes.size(); ++index) {
    value |= static_cast<std::uint64_t>(bytes[index]) << (index * 8);
  }
  return std::to_string(value);
}

Json empty_distribution() {
  return {{"meanUs", 0.0},
          {"p50Us", 0},
          {"p95Us", 0},
          {"p99Us", 0},
          {"p999Us", 0},
          {"maxUs", 0}};
}

Json empty_benchmark() {
  return {{"status", "idle"},
          {"durationSec", 0},
          {"elapsedSec", 0.0},
          {"samples", 0},
          {"cycleTime", empty_distribution()},
          {"ioDuration", empty_distribution()},
          {"scheduleJitter", empty_distribution()},
          {"over1050", 0},
          {"over1200", 0},
          {"over2000", 0},
          {"lostFrames", 0},
          {"wkcErrors", 0},
          {"startedAt", 0},
          {"completedAt", 0}};
}

void record_distribution(
    std::array<std::uint32_t, 10001>& histogram,
    std::uint64_t& sum,
    std::uint64_t& maximum,
    int value_us) {
  const auto clamped =
      std::clamp(value_us, 0, 10000);
  ++histogram[static_cast<std::size_t>(clamped)];
  sum += static_cast<std::uint64_t>(std::max(0, value_us));
  maximum = std::max(maximum, static_cast<std::uint64_t>(
                                  std::max(0, value_us)));
}

int distribution_percentile(
    const std::array<std::uint32_t, 10001>& histogram,
    std::uint64_t count,
    std::uint64_t per_mille) {
  if (count == 0) {
    return 0;
  }
  const auto target = (count * per_mille + 999) / 1000;
  std::uint64_t cumulative = 0;
  for (std::size_t bucket = 0; bucket < histogram.size(); ++bucket) {
    cumulative += histogram[bucket];
    if (cumulative >= target) {
      return static_cast<int>(bucket);
    }
  }
  return 10000;
}

Json distribution_summary(
    const std::array<std::uint32_t, 10001>& histogram,
    std::uint64_t sum,
    std::uint64_t maximum,
    std::uint64_t count) {
  return {{"meanUs",
           count == 0
               ? 0.0
               : static_cast<double>(sum) / static_cast<double>(count)},
          {"p50Us", distribution_percentile(histogram, count, 500)},
          {"p95Us", distribution_percentile(histogram, count, 950)},
          {"p99Us", distribution_percentile(histogram, count, 990)},
          {"p999Us", distribution_percentile(histogram, count, 999)},
          {"maxUs", maximum}};
}

void add_mailbox_protocol(Json& protocols,
                          std::uint16_t flags,
                          std::uint16_t flag,
                          const char* name) {
  if ((flags & flag) != 0) {
    protocols.push_back(name);
  }
}

Json mailbox_protocols(std::uint16_t flags) {
  Json protocols = Json::array();
  add_mailbox_protocol(protocols, flags, ECT_MBXPROT_COE, "CoE");
  add_mailbox_protocol(protocols, flags, ECT_MBXPROT_FOE, "FoE");
  add_mailbox_protocol(protocols, flags, ECT_MBXPROT_EOE, "EoE");
  add_mailbox_protocol(protocols, flags, ECT_MBXPROT_SOE, "SoE");
  add_mailbox_protocol(protocols, flags, ECT_MBXPROT_AOE, "AoE");
  add_mailbox_protocol(protocols, flags, ECT_MBXPROT_VOE, "VoE");
  return protocols;
}

std::uint32_t process_bytes(std::uint32_t byte_count,
                            std::uint32_t bit_count) {
  return byte_count > 0 ? byte_count : (bit_count + 7) / 8;
}

Json raw_pdo_entries(const std::uint8_t* data,
                     std::uint32_t bytes,
                     bool writable,
                     const std::string& direction) {
  Json entries = Json::array();
  if (data == nullptr || bytes == 0) {
    return entries;
  }
  const auto visible_bytes =
      std::min(bytes, kRawPdoByteLimit);
  for (std::uint32_t offset = 0; offset < visible_bytes; ++offset) {
    entries.push_back(
        {{"index", "0000"},
         {"subIndex", offset},
         {"name", direction + " byte " + std::to_string(offset)},
         {"type", "UINT8"},
         {"value", hex_value(data[offset], 2)},
         {"writable", writable},
         {"offset", offset}});
  }
  return entries;
}

bool parse_pdo_byte(const std::string& value, std::uint8_t& parsed) {
  std::string digits;
  std::size_t index = value.size() >= 2 && value[0] == '0' &&
                              (value[1] == 'x' || value[1] == 'X')
                          ? 2
                          : 0;
  for (; index < value.size(); ++index) {
    const auto character = value[index];
    if (std::isxdigit(static_cast<unsigned char>(character))) {
      digits.push_back(character);
    } else if (!std::isspace(static_cast<unsigned char>(character))) {
      return false;
    }
  }
  if (digits.empty() || digits.size() > 2) {
    return false;
  }
  try {
    parsed = static_cast<std::uint8_t>(
        std::stoul(digits, nullptr, 16));
    return true;
  } catch (const std::exception&) {
    return false;
  }
}

#ifdef _WIN32
struct WindowsAdapterIdentity {
  std::string mac;
  bool link_up = false;
};

std::string normalized_guid(std::string value) {
  const auto marker = value.find("NPF_");
  if (marker != std::string::npos) {
    value.erase(0, marker + 4);
  }
  std::transform(value.begin(), value.end(), value.begin(), [](char character) {
    return static_cast<char>(std::toupper(
        static_cast<unsigned char>(character)));
  });
  return value;
}

std::map<std::string, WindowsAdapterIdentity> windows_adapter_identities() {
  std::map<std::string, WindowsAdapterIdentity> identities;
  ULONG size = 16 * 1024;
  std::vector<std::uint8_t> storage(size);
  constexpr ULONG flags = GAA_FLAG_SKIP_ANYCAST |
                          GAA_FLAG_SKIP_MULTICAST |
                          GAA_FLAG_SKIP_DNS_SERVER;
  auto result = GetAdaptersAddresses(
      AF_UNSPEC, flags, nullptr,
      reinterpret_cast<IP_ADAPTER_ADDRESSES*>(storage.data()), &size);
  if (result == ERROR_BUFFER_OVERFLOW) {
    storage.resize(size);
    result = GetAdaptersAddresses(
        AF_UNSPEC, flags, nullptr,
        reinterpret_cast<IP_ADAPTER_ADDRESSES*>(storage.data()), &size);
  }
  if (result != NO_ERROR) {
    return identities;
  }

  for (auto* entry = reinterpret_cast<IP_ADAPTER_ADDRESSES*>(storage.data());
       entry != nullptr; entry = entry->Next) {
    WindowsAdapterIdentity identity;
    identity.link_up = entry->OperStatus == IfOperStatusUp;
    if (entry->PhysicalAddressLength > 0) {
      std::ostringstream stream;
      stream << std::uppercase << std::hex << std::setfill('0');
      for (ULONG index = 0; index < entry->PhysicalAddressLength; ++index) {
        if (index > 0) {
          stream << ':';
        }
        stream << std::setw(2)
               << static_cast<unsigned int>(entry->PhysicalAddress[index]);
      }
      identity.mac = stream.str();
    }
    identities[normalized_guid(entry->AdapterName)] =
        std::move(identity);
  }
  return identities;
}
#endif

}  // namespace

thread_local SoemBackend* SoemBackend::active_foe_backend_ = nullptr;

SoemBackend::SoemBackend() {
  soem_ = std::make_unique<SoemContext>();
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
  {
    std::scoped_lock lock(state_mutex_);
    refresh_adapters_locked();
  }
  add_log_locked("info", "CORE", "SOEM v2 physical master backend initialized");
}

SoemBackend::~SoemBackend() { stop(); }

std::string SoemBackend::mode() const { return "soem"; }

Json SoemBackend::capabilities() const {
  return {{"hardware", true},
          {"eniImport", false},
          {"eoe", false},
          {"foe", true},
          {"cyclicMailbox", true},
          {"realtimeBenchmark", true},
          {"native", true}};
}

Json SoemBackend::snapshot() {
  std::scoped_lock lock(state_mutex_);
  if (connected_) {
    refresh_slaves_locked();
  }
  config_["adapterId"] = adapter_id_;
  config_["cycleUs"] = cycle_us_;
  config_["autoTransitionOp"] = auto_transition_op_;
  const auto uptime =
      connected_
          ? std::chrono::duration_cast<std::chrono::seconds>(Clock::now() -
                                                            started_at_)
                .count()
          : 0;
  const auto expected_wkc = expected_wkc_;
  const auto latest =
      history_.empty()
          ? Json{{"at", unix_millis()},
                 {"cycleUs", 0},
                 {"jitterUs", 0},
                 {"wkc", last_wkc_},
                 {"expectedWkc", expected_wkc},
                 {"lostFrames", lost_frames_},
                 {"dcOffsetNs", 0}}
          : history_.back();
  return {{"version", ECAT_CORE_VERSION},
          {"mode", mode()},
          {"phase", phase_},
          {"connected", connected_},
          {"scanning", false},
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
           {{"active", transfer_active_},
            {"direction", transfer_direction_},
            {"fileName", transfer_file_name_},
            {"progress", transfer_progress_},
            {"progressAvailable", transfer_progress_available_},
            {"bytesCompleted", transfer_completed_bytes_},
            {"bytesTotal", transfer_total_bytes_},
            {"status", transfer_status_},
            {"message", transfer_message_}}},
          {"benchmark", benchmark_},
          {"config", config_},
          {"capabilities", capabilities()}};
}

Json SoemBackend::list_adapters() {
  std::scoped_lock lock(state_mutex_);
  refresh_adapters_locked();
  return adapters_;
}

BackendResult SoemBackend::select_adapter(const std::string& adapter_id) {
  std::scoped_lock lock(state_mutex_);
  if (connected_) {
    return BackendResult::failure("Stop the bus before changing adapters");
  }
  if (adapter_id.empty()) {
    return BackendResult::failure("Adapter identifier is empty");
  }
  if (adapters_.empty()) {
    refresh_adapters_locked();
  }
  const auto found = std::any_of(
      adapters_.begin(), adapters_.end(), [&adapter_id](const Json& adapter) {
        return adapter.value("id", "") == adapter_id;
      });
  if (!found) {
    return BackendResult::failure(
        "Adapter was not found; refresh the list and verify Npcap is installed");
  }
  adapter_id_ = adapter_id;
  config_["adapterId"] = adapter_id;
  add_log_locked("info", "ADAPTER", "Selected NPF adapter " + adapter_id);
  return BackendResult::success("Adapter selected");
}

BackendResult SoemBackend::select_slave(int slave_index) {
  std::scoped_lock lock(state_mutex_);
  if (transfer_active_) {
    return BackendResult::failure("Cannot change slaves during FoE transfer");
  }
  if (slave_index < 1 || slave_index > soem_->context.slavecount) {
    return BackendResult::failure("Slave does not exist");
  }
  selected_slave_index_ = slave_index;
  return BackendResult::success("Slave selected");
}

BackendResult SoemBackend::update_config(const Json& config) {
  std::scoped_lock lock(state_mutex_);
  if (benchmark_running_.load(std::memory_order_acquire)) {
    return BackendResult::failure(
        "Stop the realtime benchmark before changing configuration");
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
    adapter_id_ = requested_adapter;
  }
  const auto requested_cycle =
      std::clamp(next.value("cycleUs", cycle_us_), 250, 10000);
  if (connected_ && requested_cycle != cycle_us_) {
    return BackendResult::failure(
        "Stop the bus before changing the communication cycle");
  }
  cycle_us_ = requested_cycle;
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

BackendResult SoemBackend::clear_logs() {
  std::scoped_lock lock(state_mutex_);
  logs_ = Json::array();
  return BackendResult::success("Logs cleared");
}

BackendResult SoemBackend::load_eni(const std::string& file_path) {
  std::scoped_lock lock(state_mutex_);
  if (benchmark_running_.load(std::memory_order_acquire)) {
    return BackendResult::failure(
        "Stop the realtime benchmark before loading ENI");
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
  add_log_locked(
      "warning", "ENI",
      "Registered ENI file " + file_path +
          "; automatic SOEM mapping remains active until ENI mapping lands");
  return BackendResult::success(
      "ENI file registered; automatic SOEM mapping remains active",
      {{"path", file_path}, {"mappingApplied", false}});
}

BackendResult SoemBackend::start(const std::string& adapter_id,
                                 int cycle_us,
                                 bool auto_transition_op) {
  std::scoped_lock lock(state_mutex_);
  if (connected_) {
    return BackendResult::failure("Bus is already running");
  }
  if (adapter_id.empty()) {
    return BackendResult::failure("A network adapter is required");
  }
  soem_->context = ecx_contextt{};
  if (!ecx_init(&soem_->context, adapter_id.c_str())) {
    return BackendResult::failure(
        "SOEM could not open the selected network adapter; verify Npcap, "
        "administrator privileges, and that the interface is not bound to TCP/IP");
  }
  adapter_id_ = adapter_id;
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
  add_log_locked("success", "MASTER",
                 "SOEM opened network adapter " + adapter_id);
  return BackendResult::success("SOEM adapter initialized");
}

BackendResult SoemBackend::stop() {
  if (foe_thread_.joinable() &&
      foe_thread_.get_id() != std::this_thread::get_id()) {
    foe_thread_.join();
  }
  stop_cycle();
  std::scoped_lock lock(state_mutex_);
  if (benchmark_running_.exchange(false, std::memory_order_acq_rel)) {
    benchmark_stop_requested_.store(false, std::memory_order_release);
    benchmark_["status"] = "aborted";
    benchmark_["completedAt"] = unix_millis();
    add_log_locked("warning", "RT", "Realtime benchmark aborted by bus stop");
  }
  if (connected_) {
    std::scoped_lock io_lock(io_mutex_);
    soem_->context.slavelist[0].state = EC_STATE_INIT;
    ecx_writestate(&soem_->context, 0);
    ecx_close(&soem_->context);
    std::scoped_lock process_lock(process_mutex_);
    input_snapshot_.clear();
    output_snapshot_.clear();
  }
  connected_ = false;
  phase_ = "offline";
  slaves_ = Json::array();
  history_ = Json::array();
  selected_slave_index_ = 0;
  add_log_locked("warning", "MASTER", "SOEM adapter closed");
  return BackendResult::success("Bus stopped");
}

BackendResult SoemBackend::scan() {
  {
    std::scoped_lock state_lock(state_mutex_);
    if (!connected_) {
      return BackendResult::failure("Bus is not started");
    }
    if (transfer_active_) {
      return BackendResult::failure("Cannot scan during FoE transfer");
    }
    if (benchmark_running_.load(std::memory_order_acquire)) {
      return BackendResult::failure("Stop the realtime benchmark before scanning");
    }
  }
  stop_cycle();
  std::scoped_lock lock(state_mutex_);
  {
    std::scoped_lock io_lock(io_mutex_);
    if (ecx_config_init(&soem_->context) <= 0) {
      add_log_locked("error", "SCAN", "No EtherCAT slaves responded");
      return BackendResult::failure("No EtherCAT slaves found");
    }
    const auto mapped_bytes =
        ecx_config_map_group(&soem_->context, io_map_.data(), 0);
    if (mapped_bytes < 0) {
      add_log_locked("error", "SCAN", "Process data mapping failed");
      return BackendResult::failure("SOEM process data mapping failed");
    }
    if (mapped_bytes > static_cast<int>(io_map_.size())) {
      add_log_locked("error", "SCAN", "Process data exceeds the 64 KiB map");
      return BackendResult::failure("SOEM process data exceeds the I/O map");
    }
    initialize_process_snapshots_locked();
    if (config_.value("distributedClock", true)) {
      ecx_configdc(&soem_->context);
    }
    ecx_readstate(&soem_->context);
    config_["mappedInputBytes"] =
        soem_->context.grouplist[0].Ibytes;
    config_["mappedOutputBytes"] =
        soem_->context.grouplist[0].Obytes;
    add_log_locked(
        "info", "PDO",
        "Mapped " + std::to_string(soem_->context.grouplist[0].Obytes) +
            " output bytes and " +
            std::to_string(soem_->context.grouplist[0].Ibytes) +
            " input bytes from " +
            std::to_string(soem_->context.grouplist[0].nsegments) +
            " segment(s)");
  }
  refresh_slaves_locked();
  phase_ = "preop";
  expected_wkc_ =
      soem_->context.grouplist[0].outputsWKC * 2 +
      soem_->context.grouplist[0].inputsWKC;
  add_log_locked("success", "SCAN",
                 "Scan complete: " +
                     std::to_string(soem_->context.slavecount) +
                     " slaves, expected WKC " +
                     std::to_string(expected_wkc_));
  if (auto_transition_op_) {
    std::string failure;
    if (!request_state_locked(EC_STATE_OPERATIONAL, failure)) {
      return BackendResult::failure(failure);
    }
  }
  return BackendResult::success(
      "Scan complete",
      {{"count", soem_->context.slavecount},
       {"expectedWkc", expected_wkc_},
       {"mappedInputBytes", soem_->context.grouplist[0].Ibytes},
       {"mappedOutputBytes", soem_->context.grouplist[0].Obytes}});
}

BackendResult SoemBackend::transition(int slave_index,
                                      const std::string& target) {
  const auto requested = state_value(target);
  if (requested == 0) {
    return BackendResult::failure("Invalid EtherCAT state");
  }
  {
    std::scoped_lock state_lock(state_mutex_);
    if (!connected_ || slave_index < 1 ||
        slave_index > soem_->context.slavecount) {
      return BackendResult::failure("Slave does not exist");
    }
    if (transfer_active_) {
      return BackendResult::failure("Cannot change states during FoE transfer");
    }
    if (benchmark_running_.load(std::memory_order_acquire)) {
      return BackendResult::failure(
          "Stop the realtime benchmark before changing states");
    }
  }
  if (requested != EC_STATE_OPERATIONAL) {
    stop_cycle();
  }
  std::scoped_lock lock(state_mutex_);
  std::uint16_t actual = 0;
  {
    std::scoped_lock io_lock(io_mutex_);
    auto* slave = &soem_->context.slavelist[slave_index];
    if (requested == EC_STATE_OPERATIONAL) {
      ecx_send_processdata(&soem_->context);
      ecx_receive_processdata(&soem_->context, config_.value("receiveTimeoutUs", 2000));
      capture_process_inputs_locked();
    }
    slave->state = requested;
    ecx_writestate(&soem_->context, static_cast<std::uint16_t>(slave_index));
    const auto timeout = requested == EC_STATE_OPERATIONAL
                             ? EC_TIMEOUTSTATE * 8
                             : EC_TIMEOUTSTATE * 4;
    if (requested == EC_STATE_OPERATIONAL) {
      for (int attempt = 0; attempt < 10; ++attempt) {
        ecx_send_processdata(&soem_->context);
        ecx_receive_processdata(&soem_->context,
                                config_.value("receiveTimeoutUs", 2000));
        capture_process_inputs_locked();
        actual = ecx_statecheck(
            &soem_->context, static_cast<std::uint16_t>(slave_index),
            requested, EC_TIMEOUTSTATE / 10);
        if ((actual & requested) == requested) {
          break;
        }
      }
    } else {
      actual = ecx_statecheck(
          &soem_->context, static_cast<std::uint16_t>(slave_index), requested,
          timeout);
    }
    ecx_readstate(&soem_->context);
  }
  refresh_slaves_locked();
  if ((actual & requested) != requested) {
    add_log_locked("error", "SLAVE " + std::to_string(slave_index),
                   "State transition failed: " + target);
    return BackendResult::failure("Slave state transition timed out");
  }
  phase_ = aggregate_phase_locked();
  if (requested == EC_STATE_OPERATIONAL && phase_ == "op" &&
      !cycle_running_.exchange(true)) {
    {
      std::scoped_lock io_lock(io_mutex_);
      set_cyclic_mailboxes_locked(true);
    }
    cycle_thread_ = std::thread([this] {
      cycle_loop(cycle_us_,
                 config_.value("receiveTimeoutUs", 2000),
                 config_.value("realtimePriority", true),
                 config_.value("dedicatedCore", 2));
    });
  }
  add_log_locked("success", "SLAVE " + std::to_string(slave_index),
                 "State transition -> " + target);
  return BackendResult::success("Slave state changed");
}

BackendResult SoemBackend::transition_all(const std::string& target) {
  const auto requested = state_value(target);
  if (requested == 0) {
    return BackendResult::failure("Invalid EtherCAT state");
  }
  {
    std::scoped_lock state_lock(state_mutex_);
    if (!connected_) {
      return BackendResult::failure("Bus is not started");
    }
    if (transfer_active_) {
      return BackendResult::failure("Cannot change states during FoE transfer");
    }
    if (benchmark_running_.load(std::memory_order_acquire)) {
      return BackendResult::failure(
          "Stop the realtime benchmark before changing states");
    }
  }
  if (requested != EC_STATE_OPERATIONAL) {
    stop_cycle();
  }
  std::scoped_lock lock(state_mutex_);
  std::string failure;
  if (!request_state_locked(requested, failure)) {
    return BackendResult::failure(failure);
  }
  return BackendResult::success("All slaves changed state");
}

BackendResult SoemBackend::sdo_read(int slave_index,
                                    std::uint16_t index,
                                    std::uint8_t sub_index,
                                    bool complete_access) {
  bool use_cyclic_transport = false;
  {
    std::scoped_lock state_lock(state_mutex_);
    if (!connected_ || slave_index < 1 ||
        slave_index > soem_->context.slavecount) {
      return BackendResult::failure("Slave does not exist");
    }
    if (transfer_active_) {
      return BackendResult::failure("Cannot run SDO during FoE transfer");
    }
    if (benchmark_running_.load(std::memory_order_acquire)) {
      return BackendResult::failure(
          "Stop the realtime benchmark before running SDO");
    }
    use_cyclic_transport =
        cycle_running_.load(std::memory_order_acquire) &&
        soem_->context.slavelist[slave_index].mbxhandlerstate ==
            ECT_MBXH_CYCLIC;
  }
  AtomicCounterGuard mailbox_guard(mailbox_tasks_active_,
                                   use_cyclic_transport);
  std::unique_lock<std::mutex> io_lock(io_mutex_, std::defer_lock);
  if (!use_cyclic_transport) {
    io_lock.lock();
  }
  std::array<std::uint8_t, kSdoBufferBytes> buffer{};
  int size = static_cast<int>(buffer.size());
  const auto start = Clock::now();
  const auto result = ecx_SDOread(
      &soem_->context, static_cast<std::uint16_t>(slave_index), index,
      sub_index, complete_access ? TRUE : FALSE, &size, buffer.data(),
      kMailboxTimeout);
  const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
                           Clock::now() - start)
                           .count();
  if (result <= 0) {
    std::scoped_lock state_lock(state_mutex_);
    ++mailbox_errors_;
    add_log_locked("error", "SDO", "SDO upload failed");
    return BackendResult::failure("SDO upload failed");
  }
  std::vector<std::uint8_t> payload(buffer.begin(),
                                    buffer.begin() + std::max(0, size));
  return BackendResult::success(
      "SDO upload complete",
      {{"valueHex", bytes_to_hex(payload)},
       {"valueDecimal", bytes_to_decimal(payload)},
       {"elapsedUs", elapsed}});
}

BackendResult SoemBackend::sdo_write(
    int slave_index,
    std::uint16_t index,
    std::uint8_t sub_index,
    const std::vector<std::uint8_t>& payload,
    bool complete_access) {
  bool use_cyclic_transport = false;
  {
    std::scoped_lock state_lock(state_mutex_);
    if (!connected_ || slave_index < 1 ||
        slave_index > soem_->context.slavecount) {
      return BackendResult::failure("Slave does not exist");
    }
    if (transfer_active_) {
      return BackendResult::failure("Cannot run SDO during FoE transfer");
    }
    if (benchmark_running_.load(std::memory_order_acquire)) {
      return BackendResult::failure(
          "Stop the realtime benchmark before running SDO");
    }
    use_cyclic_transport =
        cycle_running_.load(std::memory_order_acquire) &&
        soem_->context.slavelist[slave_index].mbxhandlerstate ==
            ECT_MBXH_CYCLIC;
  }
  AtomicCounterGuard mailbox_guard(mailbox_tasks_active_,
                                   use_cyclic_transport);
  std::unique_lock<std::mutex> io_lock(io_mutex_, std::defer_lock);
  if (!use_cyclic_transport) {
    io_lock.lock();
  }
  const auto start = Clock::now();
  const auto result = ecx_SDOwrite(
      &soem_->context, static_cast<std::uint16_t>(slave_index), index,
      sub_index, complete_access ? TRUE : FALSE,
      static_cast<int>(payload.size()), payload.data(), kMailboxTimeout);
  const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
                           Clock::now() - start)
                           .count();
  if (result <= 0) {
    std::scoped_lock state_lock(state_mutex_);
    ++mailbox_errors_;
    add_log_locked("error", "SDO", "SDO download failed");
    return BackendResult::failure("SDO download failed");
  }
  return BackendResult::success(
      "SDO download complete",
      {{"valueHex", bytes_to_hex(payload)},
       {"valueDecimal", bytes_to_decimal(payload)},
       {"elapsedUs", elapsed}});
}

BackendResult SoemBackend::write_pdo(int slave_index,
                                     std::uint16_t index,
                                     std::uint8_t sub_index,
                                     const std::string& value) {
  std::scoped_lock state_lock(state_mutex_);
  if (!connected_ || phase_ != "op") {
    return BackendResult::failure("PDO writes require the bus to be in OP");
  }
  if (slave_index < 1 || slave_index > soem_->context.slavecount) {
    return BackendResult::failure("Slave does not exist");
  }
  if (transfer_active_) {
    return BackendResult::failure("Cannot write PDO during FoE transfer");
  }
  if (benchmark_running_.load(std::memory_order_acquire)) {
    return BackendResult::failure(
        "Stop the realtime benchmark before writing PDO");
  }
  if (index != 0x0000) {
    return BackendResult::failure(
        "Raw PDO writes require index 0000; symbolic PDO mapping is not implemented");
  }
  std::uint8_t parsed = 0;
  if (!parse_pdo_byte(value, parsed)) {
    return BackendResult::failure("PDO value must be one hexadecimal byte");
  }
  auto& entry = soem_->context.slavelist[slave_index];
  const auto bytes = process_bytes(entry.Obytes, entry.Obits);
  if (entry.outputs == nullptr || sub_index >= bytes) {
    return BackendResult::failure("Raw output PDO byte does not exist");
  }
  const auto* group_outputs = soem_->context.grouplist[0].outputs;
  if (group_outputs == nullptr || entry.outputs < group_outputs ||
      entry.outputs >= group_outputs + soem_->context.grouplist[0].Obytes) {
    return BackendResult::failure("Raw output PDO is outside the process image");
  }
  const auto group_offset =
      static_cast<std::size_t>(entry.outputs - group_outputs) + sub_index;
  {
    std::scoped_lock process_lock(process_mutex_);
    if (group_offset >= output_snapshot_.size()) {
      return BackendResult::failure("Raw output PDO snapshot is unavailable");
    }
  }
  {
    std::scoped_lock io_lock(io_mutex_);
    entry.outputs[sub_index] = parsed;
    std::scoped_lock process_lock(process_mutex_);
    output_snapshot_[group_offset] = parsed;
  }
  add_log_locked(
      "info", "PDO",
      "Slave " + std::to_string(slave_index) + " raw output byte " +
          std::to_string(sub_index) + " <- " + hex_value(parsed, 2));
  return BackendResult::success(
      "Raw PDO byte written",
      {{"slaveIndex", slave_index},
       {"offset", sub_index},
       {"valueHex", hex_value(parsed, 2)}});
}

BackendResult SoemBackend::mailbox(
    int /*slave_index*/,
    const std::string& /*protocol*/,
    const std::vector<std::uint8_t>& /*payload*/) {
  return BackendResult::failure(
      "Raw mailbox framing is not enabled; use SDO or FoE commands");
}

BackendResult SoemBackend::foe_start(const std::string& direction,
                                     const std::string& file_path,
                                     const std::string& file_name,
                                     std::uint32_t password) {
  if (direction != "download" && direction != "upload") {
    return BackendResult::failure("Invalid FoE direction");
  }
  if (file_path.empty()) {
    return BackendResult::failure("FoE file path is empty");
  }
  std::uint64_t download_size = 0;
  if (direction == "download") {
    std::error_code error;
    const auto size = std::filesystem::file_size(file_path, error);
    if (error || !std::filesystem::is_regular_file(file_path, error) ||
        size == 0 || size > kMaximumFoeBytes) {
      return BackendResult::failure(
          "FoE firmware must be an existing file between 1 byte and 64 MiB");
    }
    download_size = size;
  }
  {
    std::scoped_lock state_lock(state_mutex_);
    if (transfer_active_) {
      return BackendResult::failure("A FoE transfer is already running");
    }
    if (benchmark_running_.load(std::memory_order_acquire)) {
      return BackendResult::failure(
          "Stop the realtime benchmark before starting FoE");
    }
  }
  if (foe_thread_.joinable()) {
    foe_thread_.join();
  }

  int slave = 0;
  std::string resolved_name =
      file_name.empty() ? std::filesystem::path(file_path).filename().string()
                        : file_name;
  if (resolved_name.empty()) {
    resolved_name = "firmware.bin";
  }
  {
    std::scoped_lock state_lock(state_mutex_);
    if (!connected_ || soem_->context.slavecount < 1) {
      return BackendResult::failure("Bus is not ready for FoE");
    }
    slave = selected_slave_index_ > 0 ? selected_slave_index_ : 1;
    if (slave > soem_->context.slavecount) {
      return BackendResult::failure("Selected FoE slave does not exist");
    }
    if (transfer_active_) {
      return BackendResult::failure("A FoE transfer is already running");
    }
    transfer_active_ = true;
    transfer_direction_ = direction;
    transfer_file_name_ = resolved_name;
    transfer_status_ = "running";
    transfer_message_ = "FoE transfer in progress";
    transfer_progress_ = 0;
    transfer_progress_available_ = direction == "download";
    transfer_completed_bytes_ = 0;
    transfer_total_bytes_ = download_size;
  }
  try {
    foe_thread_ = std::thread([this, direction, file_path, resolved_name,
                               password, slave] {
      active_foe_backend_ = this;
      soem_->context.FOEhook = &SoemBackend::foe_progress_callback;
      try {
        run_foe_transfer(direction, file_path, resolved_name, password, slave);
      } catch (const std::exception& error) {
        std::scoped_lock state_lock(state_mutex_);
        transfer_active_ = false;
        transfer_status_ = "error";
        transfer_progress_ = 0;
        transfer_message_ = error.what();
        add_log_locked("error", "FoE", error.what());
      } catch (...) {
        std::scoped_lock state_lock(state_mutex_);
        transfer_active_ = false;
        transfer_status_ = "error";
        transfer_progress_ = 0;
        transfer_message_ = "Unknown FoE transfer failure";
        add_log_locked("error", "FoE", transfer_message_);
      }
      soem_->context.FOEhook = nullptr;
      active_foe_backend_ = nullptr;
    });
  } catch (const std::exception& error) {
    {
      std::scoped_lock state_lock(state_mutex_);
      transfer_active_ = false;
      transfer_status_ = "error";
      transfer_message_ = error.what();
      add_log_locked("error", "FoE", transfer_message_);
    }
    return BackendResult::failure("Could not start FoE worker thread");
  }
  return BackendResult::success(
      "FoE transfer started",
      {{"fileName", resolved_name},
       {"direction", direction},
       {"slaveIndex", slave},
       {"progressAvailable", direction == "download"},
       {"cancelSupported", false}});
}

int SoemBackend::foe_progress_callback(std::uint16_t /*slave*/,
                                       int /*packet_number*/,
                                       int data_size) {
  auto* backend = active_foe_backend_;
  if (backend == nullptr) {
    return 0;
  }
  const auto bounded_size =
      static_cast<std::uint64_t>(std::max(0, data_size));
  std::scoped_lock state_lock(backend->state_mutex_);
  if (!backend->transfer_active_) {
    return 0;
  }
  if (backend->transfer_direction_ == "download") {
    const auto remaining =
        std::min(bounded_size, backend->transfer_total_bytes_);
    backend->transfer_completed_bytes_ =
        backend->transfer_total_bytes_ - remaining;
  } else {
    backend->transfer_completed_bytes_ =
        std::max(backend->transfer_completed_bytes_, bounded_size);
  }
  if (backend->transfer_total_bytes_ > 0) {
    const auto percent = static_cast<int>(
        std::min<std::uint64_t>(
            99, (backend->transfer_completed_bytes_ * 100) /
                    backend->transfer_total_bytes_));
    backend->transfer_progress_ = percent;
  }
  backend->transfer_message_ =
      "Transferred " +
      std::to_string(backend->transfer_completed_bytes_) + " bytes";
  return 1;
}

void SoemBackend::run_foe_transfer(std::string direction,
                                   std::string file_path,
                                   std::string file_name,
                                   std::uint32_t password,
                                   int slave) {
  BackendResult result;
  if (direction == "download") {
    std::error_code error;
    const auto size = std::filesystem::file_size(file_path, error);
    if (error || !std::filesystem::is_regular_file(file_path, error) ||
        size == 0 || size > kMaximumFoeBytes) {
      result = BackendResult::failure(
          "FoE firmware must be an existing file between 1 byte and 64 MiB");
    } else {
      std::ifstream input(file_path, std::ios::binary);
      if (!input) {
        result = BackendResult::failure("Could not open FoE firmware file");
      } else {
        std::vector<std::uint8_t> bytes{
            std::istreambuf_iterator<char>(input),
            std::istreambuf_iterator<char>()};
        if (bytes.empty() || bytes.size() > kMaximumFoeBytes) {
          result = BackendResult::failure(
              "FoE firmware must be between 1 byte and 64 MiB");
        } else {
          const auto use_cyclic_transport =
              cycle_running_.load(std::memory_order_acquire) &&
              soem_->context.slavelist[slave].mbxhandlerstate ==
                  ECT_MBXH_CYCLIC;
          AtomicCounterGuard mailbox_guard(mailbox_tasks_active_,
                                           use_cyclic_transport);
          std::unique_lock<std::mutex> io_lock(io_mutex_, std::defer_lock);
          if (!use_cyclic_transport) {
            io_lock.lock();
          }
          const auto written = ecx_FOEwrite(
              &soem_->context, static_cast<std::uint16_t>(slave),
              file_name.data(), password, static_cast<int>(bytes.size()),
              bytes.data(), kMailboxTimeout);
          result =
              written > 0
                  ? BackendResult::success(
                        "FoE download complete",
                        {{"fileName", file_name}, {"bytes", bytes.size()}})
                  : BackendResult::failure("FoE write failed");
        }
      }
    }
  } else {
    std::vector<std::uint8_t> bytes(kMaximumFoeBytes);
    int size = static_cast<int>(bytes.size());
    {
      const auto use_cyclic_transport =
          cycle_running_.load(std::memory_order_acquire) &&
          soem_->context.slavelist[slave].mbxhandlerstate ==
              ECT_MBXH_CYCLIC;
      AtomicCounterGuard mailbox_guard(mailbox_tasks_active_,
                                       use_cyclic_transport);
      std::unique_lock<std::mutex> io_lock(io_mutex_, std::defer_lock);
      if (!use_cyclic_transport) {
        io_lock.lock();
      }
      const auto read = ecx_FOEread(
          &soem_->context, static_cast<std::uint16_t>(slave),
          file_name.data(), password, &size, bytes.data(), kMailboxTimeout);
      if (read <= 0) {
        result = BackendResult::failure("FoE read failed");
      } else {
        bytes.resize(std::max(0, size));
        std::ofstream output(file_path, std::ios::binary | std::ios::trunc);
        output.write(reinterpret_cast<const char*>(bytes.data()),
                     static_cast<std::streamsize>(bytes.size()));
        result = output
                     ? BackendResult::success(
                           "FoE upload complete",
                           {{"fileName", file_name}, {"bytes", bytes.size()}})
                     : BackendResult::failure("Could not write FoE output file");
      }
    }
  }
  {
    std::scoped_lock state_lock(state_mutex_);
    transfer_active_ = false;
    transfer_status_ = result.ok ? "success" : "error";
    transfer_progress_ = result.ok ? 100 : 0;
    if (result.ok && direction == "upload") {
      transfer_total_bytes_ = result.data.value("bytes", std::uint64_t{0});
    }
    if (result.ok) {
      transfer_completed_bytes_ = transfer_total_bytes_;
      transfer_progress_available_ = transfer_total_bytes_ > 0;
    }
    if (!result.ok) {
      transfer_completed_bytes_ = 0;
    }
    transfer_message_ = result.message;
    add_log_locked(result.ok ? "success" : "error", "FoE", result.message);
  }
}

BackendResult SoemBackend::foe_cancel() {
  return BackendResult::failure(
      "SOEM FoE API is blocking and cannot be cancelled safely mid-transfer");
}

BackendResult SoemBackend::benchmark_start(int duration_sec) {
  if (duration_sec < 10 || duration_sec > 8 * 60 * 60) {
    return BackendResult::failure(
        "Realtime benchmark duration must be between 10 seconds and 8 hours");
  }
  std::scoped_lock state_lock(state_mutex_);
  if (!connected_ || !cycle_running_.load(std::memory_order_acquire) ||
      phase_ != "op") {
    return BackendResult::failure(
        "Realtime benchmark requires an active OP process-data cycle");
  }
  if (transfer_active_) {
    return BackendResult::failure(
        "Stop the FoE transfer before starting a realtime benchmark");
  }
  if (benchmark_running_.load(std::memory_order_acquire)) {
    return BackendResult::failure("A realtime benchmark is already running");
  }

  benchmark_cycle_hist_.fill(0);
  benchmark_io_hist_.fill(0);
  benchmark_jitter_hist_.fill(0);
  benchmark_io_sum_us_ = 0;
  benchmark_cycle_sum_us_ = 0;
  benchmark_jitter_sum_us_ = 0;
  benchmark_io_max_us_ = 0;
  benchmark_cycle_max_us_ = 0;
  benchmark_jitter_max_us_ = 0;
  benchmark_over_1050_ = 0;
  benchmark_over_1200_ = 0;
  benchmark_over_2000_ = 0;
  benchmark_lost_frames_ = 0;
  benchmark_wkc_errors_ = 0;
  benchmark_samples_ = 0;
  benchmark_duration_sec_ = duration_sec;
  benchmark_started_at_ = Clock::now();
  benchmark_started_at_unix_ms_ = unix_millis();
  benchmark_stop_requested_.store(false, std::memory_order_release);
  benchmark_ = {
      {"status", "running"},
      {"durationSec", duration_sec},
      {"elapsedSec", 0.0},
      {"samples", 0},
      {"cycleTime", empty_distribution()},
      {"ioDuration", empty_distribution()},
      {"scheduleJitter", empty_distribution()},
      {"over1050", 0},
      {"over1200", 0},
      {"over2000", 0},
      {"lostFrames", 0},
      {"wkcErrors", 0},
      {"startedAt", benchmark_started_at_unix_ms_},
      {"completedAt", 0}};
  benchmark_running_.store(true, std::memory_order_release);
  add_log_locked(
      "info", "RT",
      "Realtime benchmark started for " + std::to_string(duration_sec) +
          " seconds at " + std::to_string(cycle_us_) + " us");
  return BackendResult::success(
      "Realtime benchmark started",
      {{"durationSec", duration_sec}, {"cycleUs", cycle_us_}});
}

BackendResult SoemBackend::benchmark_stop() {
  if (!benchmark_running_.load(std::memory_order_acquire)) {
    return BackendResult::failure("No realtime benchmark is running");
  }
  benchmark_stop_requested_.store(true, std::memory_order_release);
  std::scoped_lock state_lock(state_mutex_);
  add_log_locked("info", "RT", "Realtime benchmark stop requested");
  return BackendResult::success("Realtime benchmark stop requested");
}

void SoemBackend::record_benchmark_sample(int io_duration_us,
                                          int cycle_time_us,
                                          int jitter_us,
                                          bool wkc_ok) {
  record_distribution(benchmark_io_hist_, benchmark_io_sum_us_,
                      benchmark_io_max_us_, io_duration_us);
  record_distribution(benchmark_cycle_hist_, benchmark_cycle_sum_us_,
                      benchmark_cycle_max_us_, cycle_time_us);
  record_distribution(benchmark_jitter_hist_, benchmark_jitter_sum_us_,
                      benchmark_jitter_max_us_, jitter_us);
  ++benchmark_samples_;
  if (cycle_time_us > 1050) {
    ++benchmark_over_1050_;
  }
  if (cycle_time_us > 1200) {
    ++benchmark_over_1200_;
  }
  if (cycle_time_us > 2000) {
    ++benchmark_over_2000_;
  }
  if (!wkc_ok) {
    ++benchmark_lost_frames_;
    ++benchmark_wkc_errors_;
  }
}

void SoemBackend::cycle_loop(int cycle_us,
                             int receive_timeout_us,
                             bool realtime_priority,
                             int dedicated_core) {
#ifdef _WIN32
  if (realtime_priority) {
    SetPriorityClass(GetCurrentProcess(), HIGH_PRIORITY_CLASS);
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
  }
  if (dedicated_core >= 0 &&
      dedicated_core < static_cast<int>(sizeof(DWORD_PTR) * 8)) {
    const auto mask = static_cast<DWORD_PTR>(1) << dedicated_core;
    SetThreadAffinityMask(GetCurrentThread(), mask);
  }
  timeBeginPeriod(1);
#endif
  auto next = Clock::now();
  auto previous_cycle_start = next;
  auto last_sample = next;
  auto last_benchmark_report = next;
  std::uint64_t cycle_count = 0;
  std::uint64_t lost_count = 0;
  while (cycle_running_.load()) {
    next += std::chrono::microseconds(cycle_us);
    if (next > Clock::now()) {
      std::this_thread::sleep_until(next);
    }
    const auto cycle_start = Clock::now();
    const auto cycle_time_us =
        std::chrono::duration_cast<std::chrono::microseconds>(
            cycle_start - previous_cycle_start)
            .count();
    previous_cycle_start = cycle_start;
    const auto schedule_error_us =
        std::chrono::duration_cast<std::chrono::microseconds>(cycle_start - next)
            .count();
    int wkc = 0;
    {
      std::scoped_lock lock(io_mutex_);
      ecx_send_processdata(&soem_->context);
      wkc = ecx_receive_processdata(&soem_->context,
                                    receive_timeout_us);
      if (mailbox_tasks_active_.load(std::memory_order_acquire) > 0) {
        ecx_mbxhandler(&soem_->context, 0, kMailboxStepsPerCycle);
      }
      capture_process_inputs_locked();
    }
    const auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
                             Clock::now() - cycle_start)
                             .count();
    ++cycle_count;
    if (wkc < expected_wkc_) {
      ++lost_count;
    }
    const bool benchmark_active =
        benchmark_running_.load(std::memory_order_acquire);
    if (benchmark_active) {
      record_benchmark_sample(
          static_cast<int>(elapsed),
          static_cast<int>(cycle_time_us),
          static_cast<int>(std::abs(schedule_error_us)),
          wkc >= expected_wkc_);
    }

    const auto now = Clock::now();
    if (now - last_sample >= std::chrono::milliseconds(50)) {
      last_sample = now;
      Json benchmark_report;
      bool finish_benchmark = false;
      if (benchmark_active) {
        const auto elapsed_benchmark = now - benchmark_started_at_;
        finish_benchmark =
            benchmark_stop_requested_.load(std::memory_order_acquire) ||
            elapsed_benchmark >=
                std::chrono::seconds(benchmark_duration_sec_);
        if (finish_benchmark ||
            now - last_benchmark_report >= std::chrono::seconds(1)) {
          last_benchmark_report = now;
          const auto elapsed_seconds =
              std::chrono::duration<double>(elapsed_benchmark).count();
          benchmark_report = {
              {"status", finish_benchmark ? "completed" : "running"},
              {"durationSec", benchmark_duration_sec_},
              {"elapsedSec", elapsed_seconds},
              {"samples", benchmark_samples_},
              {"cycleTime",
               distribution_summary(
                   benchmark_cycle_hist_, benchmark_cycle_sum_us_,
                   benchmark_cycle_max_us_, benchmark_samples_)},
              {"ioDuration",
               distribution_summary(
                   benchmark_io_hist_, benchmark_io_sum_us_,
                   benchmark_io_max_us_, benchmark_samples_)},
              {"scheduleJitter",
               distribution_summary(
                   benchmark_jitter_hist_, benchmark_jitter_sum_us_,
                   benchmark_jitter_max_us_, benchmark_samples_)},
              {"over1050", benchmark_over_1050_},
              {"over1200", benchmark_over_1200_},
              {"over2000", benchmark_over_2000_},
              {"lostFrames", benchmark_lost_frames_},
              {"wkcErrors", benchmark_wkc_errors_},
              {"startedAt", benchmark_started_at_unix_ms_},
              {"completedAt", finish_benchmark ? unix_millis() : 0}};
          if (finish_benchmark &&
              benchmark_stop_requested_.load(std::memory_order_acquire)) {
            benchmark_report["status"] = "stopped";
          }
        }
      }
      std::scoped_lock lock(state_mutex_);
      cycles_ += cycle_count;
      lost_frames_ += lost_count;
      last_wkc_ = wkc;
      history_.push_back(
          Json{{"at", unix_millis()},
               {"cycleUs", static_cast<int>(elapsed)},
               {"jitterUs", static_cast<int>(
                                std::abs(schedule_error_us))},
               {"wkc", wkc},
               {"expectedWkc", expected_wkc_},
               {"lostFrames", lost_frames_},
               {"dcOffsetNs", 0}});
      while (history_.size() > kHistoryLimit) {
        history_.erase(history_.begin());
      }
      cycle_count = 0;
      lost_count = 0;
      if (!benchmark_report.is_null()) {
        benchmark_ = std::move(benchmark_report);
      }
      if (finish_benchmark) {
        benchmark_running_.store(false, std::memory_order_release);
        benchmark_stop_requested_.store(false, std::memory_order_release);
        add_log_locked(
            "info", "RT",
            "Realtime benchmark finished with " +
                std::to_string(benchmark_samples_) + " samples");
      }
    }

    if (next < now - std::chrono::microseconds(cycle_us * 2)) {
      next = now;
    }
  }
#ifdef _WIN32
  timeEndPeriod(1);
#endif
  if (cycle_count > 0) {
    std::scoped_lock lock(state_mutex_);
    cycles_ += cycle_count;
    lost_frames_ += lost_count;
  }
}

void SoemBackend::stop_cycle() {
  cycle_running_.store(false);
  if (cycle_thread_.joinable() &&
      cycle_thread_.get_id() != std::this_thread::get_id()) {
    cycle_thread_.join();
  }
  if (soem_->context.slavecount > 0) {
    std::scoped_lock io_lock(io_mutex_);
    set_cyclic_mailboxes_locked(false);
  }
}

void SoemBackend::set_cyclic_mailboxes_locked(bool enabled) {
  for (int index = 1; index <= soem_->context.slavecount; ++index) {
    auto& slave = soem_->context.slavelist[index];
    if (enabled) {
      if (!ecx_slavembxcyclic(&soem_->context,
                             static_cast<std::uint16_t>(index))) {
        slave.mbxhandlerstate = ECT_MBXH_NONE;
      }
    } else {
      slave.mbxhandlerstate = ECT_MBXH_NONE;
    }
  }
}

void SoemBackend::initialize_process_snapshots_locked() {
  const auto& group = soem_->context.grouplist[0];
  std::scoped_lock lock(process_mutex_);
  input_snapshot_.resize(group.Ibytes);
  output_snapshot_.resize(group.Obytes);
  if (group.inputs != nullptr && group.Ibytes > 0) {
    std::copy_n(group.inputs, group.Ibytes, input_snapshot_.data());
  }
  if (group.outputs != nullptr && group.Obytes > 0) {
    std::copy_n(group.outputs, group.Obytes, output_snapshot_.data());
  }
}

void SoemBackend::capture_process_inputs_locked() {
  const auto& group = soem_->context.grouplist[0];
  if (group.inputs == nullptr || group.Ibytes == 0) {
    return;
  }
  std::scoped_lock lock(process_mutex_);
  if (input_snapshot_.size() != group.Ibytes) {
    input_snapshot_.resize(group.Ibytes);
  }
  std::copy_n(group.inputs, group.Ibytes, input_snapshot_.data());
}

void SoemBackend::refresh_adapters_locked() {
  std::map<std::string, std::uint32_t> interface_flags;
#ifdef _WIN32
  pcap_if_t* pcap_devices = nullptr;
  char error_buffer[PCAP_ERRBUF_SIZE]{};
  if (pcap_findalldevs(&pcap_devices, error_buffer) == 0) {
    for (auto* device = pcap_devices; device != nullptr; device = device->next) {
      if (device->name != nullptr) {
        interface_flags[device->name] = device->flags;
      }
    }
    pcap_freealldevs(pcap_devices);
  }
  const auto identities = windows_adapter_identities();
#endif

  adapters_ = Json::array();
  auto* head = ec_find_adapters();
  for (auto* adapter = head; adapter != nullptr; adapter = adapter->next) {
    const std::string interface_name(adapter->name);
    if (interface_name.empty()) {
      continue;
    }
    const std::string description(adapter->desc);
    if (description.find("Loopback") != std::string::npos ||
        interface_name.find("Loopback") != std::string::npos ||
        description.find("WAN Miniport") != std::string::npos ||
        description.find("Wi-Fi Direct Virtual Adapter") !=
            std::string::npos ||
        description.find("Hyper-V Virtual") != std::string::npos ||
        description.find("VMware Virtual") != std::string::npos) {
      continue;
    }
    const auto flags = interface_flags.find(interface_name);
    bool link_up = true;
    std::string mac = "--";
#ifdef _WIN32
    if (flags != interface_flags.end()) {
      if ((flags->second & PCAP_IF_WIRELESS) != 0) {
        continue;
      }
      link_up =
          (flags->second & PCAP_IF_UP) != 0 &&
          (flags->second & PCAP_IF_CONNECTION_STATUS) !=
              PCAP_IF_CONNECTION_STATUS_DISCONNECTED;
    }
    const auto identity = identities.find(normalized_guid(interface_name));
    if (identity != identities.end()) {
      link_up = identity->second.link_up;
      if (!identity->second.mac.empty()) {
        mac = identity->second.mac;
      }
    }
#else
    static_cast<void>(flags);
#endif
    adapters_.push_back(
        {{"id", interface_name},
         {"name", description.empty() ? interface_name : description},
         {"description", interface_name},
         {"mac", mac},
         {"linkUp", link_up},
         {"driver", "Npcap / NPF"},
         {"dedicated", true}});
  }
  ec_free_adapters(head);
}

void SoemBackend::refresh_slaves_locked() {
  std::vector<std::uint8_t> input_snapshot;
  std::vector<std::uint8_t> output_snapshot;
  {
    std::scoped_lock process_lock(process_mutex_);
    input_snapshot = input_snapshot_;
    output_snapshot = output_snapshot_;
  }
  const auto* group_inputs = soem_->context.grouplist[0].inputs;
  const auto* group_outputs = soem_->context.grouplist[0].outputs;
  slaves_ = Json::array();
  for (int index = 1; index <= soem_->context.slavecount; ++index) {
    const auto& entry = soem_->context.slavelist[index];
    const auto name = std::string(entry.name);
    const auto state = static_cast<std::uint16_t>(entry.state & 0x0f);
    const auto input_bytes = process_bytes(entry.Ibytes, entry.Ibits);
    const auto output_bytes = process_bytes(entry.Obytes, entry.Obits);
    Json inputs = Json::array();
    Json outputs = Json::array();
    if (group_inputs != nullptr && entry.inputs != nullptr &&
        entry.inputs >= group_inputs &&
        entry.inputs + input_bytes <=
            group_inputs + soem_->context.grouplist[0].Ibytes) {
      const auto offset =
          static_cast<std::size_t>(entry.inputs - group_inputs);
      if (offset + input_bytes <= input_snapshot.size()) {
        inputs = raw_pdo_entries(input_snapshot.data() + offset, input_bytes,
                                 false, "Input");
      }
    }
    if (group_outputs != nullptr && entry.outputs != nullptr &&
        entry.outputs >= group_outputs &&
        entry.outputs + output_bytes <=
            group_outputs + soem_->context.grouplist[0].Obytes) {
      const auto offset =
          static_cast<std::size_t>(entry.outputs - group_outputs);
      if (offset + output_bytes <= output_snapshot.size()) {
        outputs = raw_pdo_entries(output_snapshot.data() + offset, output_bytes,
                                  true, "Output");
      }
    }
    slaves_.push_back(
        {{"index", index},
         {"name", name.empty() ? "EtherCAT slave " + std::to_string(index)
                               : name},
         {"vendorId", hex_value(entry.eep_man, 8)},
         {"productCode", hex_value(entry.eep_id, 8)},
         {"revision", hex_value(entry.eep_rev, 8)},
         {"serial", hex_value(entry.eep_ser, 8)},
         {"state", state_name(state)},
         {"alStatus", entry.ALstatuscode},
         {"alStatusCode", hex_value(entry.ALstatuscode, 4)},
         {"wkc", last_wkc_},
         {"dcEnabled", (entry.DCactive & 0x01) != 0},
         {"mailboxProtocols", mailbox_protocols(entry.mbx_proto)},
         {"inputs", std::move(inputs)},
         {"outputs", std::move(outputs)},
         {"inputBits", entry.Ibits},
         {"outputBits", entry.Obits}});
  }
  if (!slaves_.empty() && selected_slave_index_ == 0) {
    selected_slave_index_ = 1;
  }
  if (selected_slave_index_ > soem_->context.slavecount) {
    selected_slave_index_ = soem_->context.slavecount > 0 ? 1 : 0;
  }
}

std::string SoemBackend::aggregate_phase_locked() const {
  if (slaves_.empty()) {
    return connected_ ? "preop" : "offline";
  }
  bool all_operational = true;
  bool all_at_least_safe = true;
  bool all_at_least_preop = true;
  for (const auto& slave : slaves_) {
    const auto state = slave.value("state", "INIT");
    all_operational = all_operational && state == "OP";
    all_at_least_safe =
        all_at_least_safe && (state == "SAFE-OP" || state == "OP");
    all_at_least_preop =
        all_at_least_preop &&
        (state == "PRE-OP" || state == "SAFE-OP" || state == "OP");
  }
  if (all_operational) {
    return "op";
  }
  if (all_at_least_safe) {
    return "safeop";
  }
  if (all_at_least_preop) {
    return "preop";
  }
  return "offline";
}

void SoemBackend::add_log_locked(const std::string& level,
                                 const std::string& source,
                                 const std::string& message) {
  const Json entry = {{"id", "soem-" + std::to_string(++log_counter_)},
                      {"at", unix_millis()},
                      {"level", level},
                      {"source", source},
                      {"message", message}};
  logs_.insert(logs_.begin(), entry);
  while (logs_.size() > 240) {
    logs_.erase(logs_.end() - 1);
  }
}

bool SoemBackend::request_state_locked(std::uint16_t state,
                                       std::string& failure) {
  std::uint16_t actual = 0;
  {
    std::scoped_lock io_lock(io_mutex_);
    if (state == EC_STATE_OPERATIONAL) {
      actual = ecx_statecheck(&soem_->context, 0, EC_STATE_SAFE_OP,
                              EC_TIMEOUTSTATE * 4);
      if ((actual & EC_STATE_SAFE_OP) != EC_STATE_SAFE_OP) {
        ecx_readstate(&soem_->context);
        failure = "Not all slaves reached SAFE-OP";
        add_log_locked("error", "MASTER", failure);
        refresh_slaves_locked();
        phase_ = aggregate_phase_locked();
        return false;
      }
      ecx_send_processdata(&soem_->context);
      ecx_receive_processdata(&soem_->context,
                              config_.value("receiveTimeoutUs", 2000));
      capture_process_inputs_locked();
    }

    soem_->context.slavelist[0].state = state;
    ecx_writestate(&soem_->context, 0);
    if (state == EC_STATE_OPERATIONAL) {
      for (int attempt = 0; attempt < 10; ++attempt) {
        ecx_send_processdata(&soem_->context);
        ecx_receive_processdata(&soem_->context,
                                config_.value("receiveTimeoutUs", 2000));
        capture_process_inputs_locked();
        actual = ecx_statecheck(&soem_->context, 0, state,
                                EC_TIMEOUTSTATE / 10);
        if ((actual & state) == state) {
          break;
        }
      }
    } else {
      actual = ecx_statecheck(&soem_->context, 0, state,
                              EC_TIMEOUTSTATE * 4);
    }
    ecx_readstate(&soem_->context);
  }
  if ((actual & state) != state) {
    failure = "EtherCAT state transition timed out; inspect slave AL status";
    add_log_locked("error", "MASTER", failure);
    refresh_slaves_locked();
    phase_ = aggregate_phase_locked();
    return false;
  }
  refresh_slaves_locked();
  if (state == EC_STATE_OPERATIONAL) {
    {
      std::scoped_lock io_lock(io_mutex_);
      set_cyclic_mailboxes_locked(true);
    }
    phase_ = "op";
    if (!cycle_running_.exchange(true)) {
      cycle_thread_ = std::thread([this] {
        cycle_loop(cycle_us_,
                   config_.value("receiveTimeoutUs", 2000),
                   config_.value("realtimePriority", true),
                   config_.value("dedicatedCore", 2));
      });
    }
    add_log_locked("info", "MAILBOX",
                   "Cyclic mailbox scheduling enabled for OP process data");
  } else if (state == EC_STATE_SAFE_OP) {
    phase_ = "safeop";
  } else if (state == EC_STATE_PRE_OP) {
    phase_ = "preop";
  } else {
    phase_ = "offline";
  }
  add_log_locked("success", "MASTER",
                 "Group state -> " + state_name(state));
  return true;
}

std::string SoemBackend::state_name(std::uint16_t state) {
  switch (state & 0x0f) {
    case EC_STATE_INIT:
      return "INIT";
    case EC_STATE_PRE_OP:
      return "PRE-OP";
    case EC_STATE_SAFE_OP:
      return "SAFE-OP";
    case EC_STATE_OPERATIONAL:
      return "OP";
    default:
      return "INIT";
  }
}

std::uint16_t SoemBackend::state_value(const std::string& state) {
  if (state == "INIT") {
    return EC_STATE_INIT;
  }
  if (state == "PRE-OP") {
    return EC_STATE_PRE_OP;
  }
  if (state == "SAFE-OP") {
    return EC_STATE_SAFE_OP;
  }
  if (state == "OP") {
    return EC_STATE_OPERATIONAL;
  }
  return 0;
}

}  // namespace ecat

#endif  // ECAT_HAS_SOEM
