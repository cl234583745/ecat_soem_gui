#pragma once

#include <array>
#include <chrono>
#include <cstdint>
#include <deque>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "ecat_core/backend.hpp"

namespace ecat {

class SimBackend final : public MasterBackend {
 public:
  SimBackend();
  ~SimBackend() override = default;

  std::string mode() const override;
  Json capabilities() const override;
  Json snapshot() override;
  Json list_adapters() override;
  BackendResult select_adapter(const std::string& adapter_id) override;
  BackendResult select_slave(int slave_index) override;
  BackendResult update_config(const Json& config) override;
  BackendResult clear_logs() override;
  BackendResult load_eni(const std::string& file_path) override;
  BackendResult start(const std::string& adapter_id,
                      int cycle_us,
                      bool auto_transition_op) override;
  BackendResult stop() override;
  BackendResult scan() override;
  BackendResult transition(int slave_index,
                           const std::string& target) override;
  BackendResult transition_all(const std::string& target) override;
  BackendResult sdo_read(int slave_index,
                         std::uint16_t index,
                         std::uint8_t sub_index,
                         bool complete_access) override;
  BackendResult sdo_write(int slave_index,
                          std::uint16_t index,
                          std::uint8_t sub_index,
                          const std::vector<std::uint8_t>& payload,
                          bool complete_access) override;
  BackendResult write_pdo(int slave_index,
                          std::uint16_t index,
                          std::uint8_t sub_index,
                          const std::string& value) override;
  BackendResult mailbox(int slave_index,
                        const std::string& protocol,
                        const std::vector<std::uint8_t>& payload) override;
  BackendResult foe_start(const std::string& direction,
                          const std::string& file_path,
                          const std::string& file_name,
                          std::uint32_t password) override;
  BackendResult foe_cancel() override;
  BackendResult benchmark_start(int duration_sec) override;
  BackendResult benchmark_stop() override;

 private:
  using Clock = std::chrono::steady_clock;

  void refresh_locked();
  void update_benchmark_locked();
  std::optional<BackendResult> benchmark_guard_locked(
      std::string_view operation) const;
  void add_log_locked(const std::string& level,
                      const std::string& source,
                      const std::string& message);
  Json make_slave(int index,
                  const std::string& name,
                  const std::string& vendor_id,
                  const std::string& product_code,
                  const std::string& revision,
                  const std::array<std::string, 2>& protocols) const;
  void create_demo_slaves_locked();
  bool has_slave_locked(int index) const;
  std::string aggregate_phase_locked() const;
  bool transition_all_locked(const std::string& target,
                             std::string& failure_message);

  mutable std::mutex mutex_;
  bool connected_ = false;
  bool scanning_ = false;
  bool auto_transition_op_ = true;
  int cycle_us_ = 1000;
  std::string adapter_id_ = "sim:intel-i219";
  std::string phase_ = "offline";
  int selected_slave_index_ = 0;
  std::uint64_t cycles_ = 0;
  std::uint64_t lost_frames_ = 0;
  std::uint64_t mailbox_errors_ = 0;
  Clock::time_point started_at_ = Clock::now();
  Clock::time_point last_sample_at_ = Clock::now();
  Json slaves_ = Json::array();
  Json logs_ = Json::array();
  Json history_ = Json::array();
  Json adapters_;
  Json benchmark_;
  std::uint64_t log_counter_ = 0;
  Json config_;
  Clock::time_point benchmark_started_at_ = Clock::now();
  std::int64_t benchmark_started_at_unix_ms_ = 0;
  int benchmark_duration_sec_ = 0;
  std::string benchmark_status_ = "idle";
};

}  // namespace ecat
