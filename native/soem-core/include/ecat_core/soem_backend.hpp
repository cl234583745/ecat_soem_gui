#pragma once

#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include "ecat_core/backend.hpp"

namespace ecat {

class SoemBackend final : public MasterBackend {
 public:
  SoemBackend();
  ~SoemBackend() override;

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
  struct SoemContext;

  void cycle_loop(int cycle_us,
                  int receive_timeout_us,
                  bool realtime_priority,
                  int dedicated_core);
  void stop_cycle();
  // Callers must hold io_mutex_ while accessing the SOEM process image.
  void initialize_process_snapshots_locked();
  void capture_process_inputs_locked();
  void run_foe_transfer(std::string direction,
                        std::string file_path,
                        std::string file_name,
                        std::uint32_t password,
                        int slave);
  static int foe_progress_callback(std::uint16_t slave,
                                   int packet_number,
                                   int data_size);
  void set_cyclic_mailboxes_locked(bool enabled);
  void record_benchmark_sample(int io_duration_us,
                               int cycle_time_us,
                               int jitter_us,
                               bool wkc_ok);
  void refresh_adapters_locked();
  void refresh_slaves_locked();
  std::string aggregate_phase_locked() const;
  void add_log_locked(const std::string& level,
                      const std::string& source,
                      const std::string& message);
  bool request_state_locked(std::uint16_t state, std::string& failure);
  static std::string state_name(std::uint16_t state);
  static std::uint16_t state_value(const std::string& state);

  mutable std::mutex state_mutex_;
  mutable std::mutex io_mutex_;
  mutable std::mutex process_mutex_;
  std::array<std::uint8_t, 65536> io_map_{};
  std::vector<std::uint8_t> input_snapshot_;
  std::vector<std::uint8_t> output_snapshot_;
  std::unique_ptr<SoemContext> soem_;
  std::string adapter_id_;
  std::string phase_ = "offline";
  bool connected_ = false;
  bool auto_transition_op_ = true;
  int cycle_us_ = 1000;
  int selected_slave_index_ = 0;
  int expected_wkc_ = 0;
  int last_wkc_ = 0;
  std::uint64_t cycles_ = 0;
  std::uint64_t lost_frames_ = 0;
  std::uint64_t mailbox_errors_ = 0;
  Clock::time_point started_at_ = Clock::now();
  Json adapters_ = Json::array();
  Json slaves_ = Json::array();
  Json logs_ = Json::array();
  Json history_ = Json::array();
  std::uint64_t log_counter_ = 0;
  std::atomic<bool> cycle_running_{false};
  std::atomic<int> mailbox_tasks_active_{0};
  std::thread cycle_thread_;
  std::thread foe_thread_;
  static thread_local SoemBackend* active_foe_backend_;
  static constexpr std::size_t kBenchmarkBucketCount = 10001;
  bool transfer_active_ = false;
  std::string transfer_direction_ = "download";
  std::string transfer_file_name_;
  std::string transfer_status_ = "idle";
  std::string transfer_message_ = "Idle";
  int transfer_progress_ = 0;
  bool transfer_progress_available_ = false;
  std::uint64_t transfer_completed_bytes_ = 0;
  std::uint64_t transfer_total_bytes_ = 0;
  std::atomic<bool> benchmark_running_{false};
  std::atomic<bool> benchmark_stop_requested_{false};
  std::array<std::uint32_t, kBenchmarkBucketCount> benchmark_io_hist_{};
  std::array<std::uint32_t, kBenchmarkBucketCount> benchmark_cycle_hist_{};
  std::array<std::uint32_t, kBenchmarkBucketCount> benchmark_jitter_hist_{};
  std::uint64_t benchmark_io_sum_us_ = 0;
  std::uint64_t benchmark_cycle_sum_us_ = 0;
  std::uint64_t benchmark_jitter_sum_us_ = 0;
  std::uint64_t benchmark_io_max_us_ = 0;
  std::uint64_t benchmark_cycle_max_us_ = 0;
  std::uint64_t benchmark_jitter_max_us_ = 0;
  std::uint64_t benchmark_over_1050_ = 0;
  std::uint64_t benchmark_over_1200_ = 0;
  std::uint64_t benchmark_over_2000_ = 0;
  std::uint64_t benchmark_lost_frames_ = 0;
  std::uint64_t benchmark_wkc_errors_ = 0;
  std::uint64_t benchmark_samples_ = 0;
  Clock::time_point benchmark_started_at_ = Clock::now();
  std::int64_t benchmark_started_at_unix_ms_ = 0;
  int benchmark_duration_sec_ = 0;
  Json benchmark_;
  Json config_;
};

}  // namespace ecat
