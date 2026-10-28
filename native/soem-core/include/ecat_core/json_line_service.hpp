#pragma once

#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include "ecat_core/backend.hpp"

namespace ecat {

class JsonLineService {
 public:
  explicit JsonLineService(std::unique_ptr<MasterBackend> backend);
  ~JsonLineService();

  int run();

 private:
  Json handle(const Json& request);
  Json response_for(const Json& request);
  void send(Json message);
  void start_event_publisher();
  void stop_event_publisher();

  std::unique_ptr<MasterBackend> backend_;
  std::atomic<bool> running_{false};
  std::thread event_thread_;
  std::mutex output_mutex_;
};

}  // namespace ecat
