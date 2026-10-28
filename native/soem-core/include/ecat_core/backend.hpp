#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

namespace ecat {

using Json = nlohmann::json;

struct BackendResult {
  bool ok = false;
  std::string message;
  Json data = Json::object();

  static BackendResult success(std::string message = {}, Json data = {}) {
    return {true, std::move(message), std::move(data)};
  }

  static BackendResult failure(std::string message) {
    return {false, std::move(message), Json::object()};
  }
};

class MasterBackend {
 public:
  virtual ~MasterBackend() = default;

  virtual std::string mode() const = 0;
  virtual Json capabilities() const = 0;
  virtual Json snapshot() = 0;
  virtual Json list_adapters() = 0;
  virtual BackendResult select_adapter(const std::string& adapter_id) = 0;
  virtual BackendResult select_slave(int slave_index) = 0;
  virtual BackendResult update_config(const Json& config) = 0;
  virtual BackendResult clear_logs() = 0;
  virtual BackendResult load_eni(const std::string& file_path) = 0;
  virtual BackendResult start(const std::string& adapter_id,
                              int cycle_us,
                              bool auto_transition_op) = 0;
  virtual BackendResult stop() = 0;
  virtual BackendResult scan() = 0;
  virtual BackendResult transition(int slave_index,
                                   const std::string& target) = 0;
  virtual BackendResult transition_all(const std::string& target) = 0;
  virtual BackendResult sdo_read(int slave_index,
                                 std::uint16_t index,
                                 std::uint8_t sub_index,
                                 bool complete_access) = 0;
  virtual BackendResult sdo_write(int slave_index,
                                  std::uint16_t index,
                                  std::uint8_t sub_index,
                                  const std::vector<std::uint8_t>& payload,
                                  bool complete_access) = 0;
  virtual BackendResult write_pdo(int slave_index,
                                  std::uint16_t index,
                                  std::uint8_t sub_index,
                                  const std::string& value) = 0;
  virtual BackendResult mailbox(int slave_index,
                                const std::string& protocol,
                                const std::vector<std::uint8_t>& payload) = 0;
  virtual BackendResult foe_start(const std::string& direction,
                                  const std::string& file_path,
                                  const std::string& file_name,
                                  std::uint32_t password) = 0;
  virtual BackendResult foe_cancel() = 0;
  virtual BackendResult benchmark_start(int duration_sec) = 0;
  virtual BackendResult benchmark_stop() = 0;
};

}  // namespace ecat
