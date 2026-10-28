#include "ecat_core/json_line_service.hpp"

#include <cctype>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <stdexcept>
#include <utility>
#include <vector>

namespace ecat {
namespace {

std::uint16_t parse_hex_u16(const std::string& value) {
  try {
    return static_cast<std::uint16_t>(std::stoul(value, nullptr, 16));
  } catch (const std::exception&) {
    throw std::invalid_argument("Invalid hexadecimal index");
  }
}

std::uint8_t parse_hex_u8(const std::string& value) {
  try {
    return static_cast<std::uint8_t>(std::stoul(value, nullptr, 16));
  } catch (const std::exception&) {
    throw std::invalid_argument("Invalid hexadecimal subindex");
  }
}

std::vector<std::uint8_t> parse_hex_bytes(const std::string& value) {
  std::string normalized;
  normalized.reserve(value.size());
  for (const auto character : value) {
    if (std::isxdigit(static_cast<unsigned char>(character))) {
      normalized.push_back(character);
    }
  }
  if (normalized.size() % 2 != 0) {
    throw std::invalid_argument("Hex payload must contain complete bytes");
  }
  std::vector<std::uint8_t> bytes;
  bytes.reserve(normalized.size() / 2);
  for (std::size_t index = 0; index < normalized.size(); index += 2) {
    bytes.push_back(static_cast<std::uint8_t>(
        std::stoul(normalized.substr(index, 2), nullptr, 16)));
  }
  return bytes;
}

}  // namespace

JsonLineService::JsonLineService(std::unique_ptr<MasterBackend> backend)
    : backend_(std::move(backend)) {}

JsonLineService::~JsonLineService() { stop_event_publisher(); }

int JsonLineService::run() {
  running_.store(true);
  start_event_publisher();
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) {
      continue;
    }
    try {
      const auto request = Json::parse(line);
      const auto response = response_for(request);
      if (!response.is_null()) {
        send(response);
      }
    } catch (const std::exception& error) {
      send({{"type", "response"},
            {"id", nullptr},
            {"ok", false},
            {"message", std::string("Protocol error: ") + error.what()}});
    }
  }
  stop_event_publisher();
  return 0;
}

Json JsonLineService::handle(const Json& request) {
  const auto command = request.value("command", "");
  const auto params = request.value("params", Json::object());
  BackendResult result;

  if (command == "hello") {
    return {{"ok", true},
            {"message", "Native EtherCAT core ready"},
            {"data",
             {{"mode", backend_->mode()},
              {"capabilities", backend_->capabilities()}}}};
  }
  if (command == "get_snapshot") {
    return {{"ok", true}, {"message", "Snapshot"}, {"data", backend_->snapshot()}};
  }
  if (command == "list_adapters") {
    return {{"ok", true},
            {"message", "Adapters"},
            {"data", backend_->list_adapters()}};
  }
  if (command == "select_adapter") {
    result = backend_->select_adapter(params.value("adapterId", ""));
  } else if (command == "select_slave") {
    result = backend_->select_slave(params.value("slaveIndex", 0));
  } else if (command == "update_config") {
    result = backend_->update_config(params.value("config", Json::object()));
  } else if (command == "clear_logs") {
    result = backend_->clear_logs();
  } else if (command == "load_eni") {
    result = backend_->load_eni(params.value("filePath", ""));
  } else if (command == "start") {
    result = backend_->start(params.value("adapterId", "sim:intel-i219"),
                             params.value("cycleUs", 1000),
                             params.value("autoTransitionOp", true));
  } else if (command == "stop") {
    result = backend_->stop();
  } else if (command == "scan") {
    result = backend_->scan();
  } else if (command == "transition") {
    result = backend_->transition(params.value("slaveIndex", 0),
                                  params.value("target", "OP"));
  } else if (command == "transition_all") {
    result = backend_->transition_all(params.value("target", "OP"));
  } else if (command == "sdo_read") {
    result = backend_->sdo_read(
        params.value("slaveIndex", 0),
        parse_hex_u16(params.value("index", "0")),
        parse_hex_u8(params.value("subIndex", "0")),
        params.value("completeAccess", false));
  } else if (command == "sdo_write") {
    result = backend_->sdo_write(
        params.value("slaveIndex", 0),
        parse_hex_u16(params.value("index", "0")),
        parse_hex_u8(params.value("subIndex", "0")),
        parse_hex_bytes(params.value("valueHex", "")),
        params.value("completeAccess", false));
  } else if (command == "write_pdo") {
    result = backend_->write_pdo(
        params.value("slaveIndex", 0),
        parse_hex_u16(params.value("index", "0")),
        parse_hex_u8(params.value("subIndex", "0")),
        params.value("value", ""));
  } else if (command == "mailbox") {
    result = backend_->mailbox(
        params.value("slaveIndex", 0),
        params.value("protocol", "CoE"),
        parse_hex_bytes(params.value("payloadHex", "")));
  } else if (command == "foe_start") {
    result = backend_->foe_start(
        params.value("direction", "download"),
        params.value("filePath", ""),
        params.value("fileName", ""),
        static_cast<std::uint32_t>(params.value("password", 0)));
  } else if (command == "foe_cancel") {
    result = backend_->foe_cancel();
  } else if (command == "benchmark_start") {
    result = backend_->benchmark_start(params.value("durationSec", 60));
  } else if (command == "benchmark_stop") {
    result = backend_->benchmark_stop();
  } else {
    return {{"ok", false},
            {"message", "Unknown command: " + command},
            {"data", Json::object()}};
  }

  return {{"ok", result.ok},
          {"message", result.message},
          {"data", result.data}};
}

Json JsonLineService::response_for(const Json& request) {
  const auto id = request.contains("id") ? request["id"] : Json(nullptr);
  try {
    const auto result = handle(request);
    return {{"type", "response"},
            {"id", id},
            {"ok", result.value("ok", false)},
            {"message", result.value("message", "")},
            {"data", result.value("data", Json::object())}};
  } catch (const std::exception& error) {
    return {{"type", "response"},
            {"id", id},
            {"ok", false},
            {"message", error.what()},
            {"data", Json::object()}};
  }
}

void JsonLineService::send(Json message) {
  std::scoped_lock lock(output_mutex_);
  std::cout << message.dump() << '\n' << std::flush;
}

void JsonLineService::start_event_publisher() {
  event_thread_ = std::thread([this] {
    while (running_.load()) {
      std::this_thread::sleep_for(std::chrono::milliseconds(100));
      if (!running_.load()) {
        break;
      }
      try {
        send({{"type", "event"},
              {"event", "snapshot"},
              {"data", backend_->snapshot()}});
      } catch (const std::exception& error) {
        send({{"type", "event"},
              {"event", "core_error"},
              {"data", {{"message", error.what()}}}});
      }
    }
  });
}

void JsonLineService::stop_event_publisher() {
  running_.store(false);
  if (event_thread_.joinable()) {
    event_thread_.join();
  }
}

}  // namespace ecat
