#include <iostream>
#include <memory>
#include <string>

#include "ecat_core/json_line_service.hpp"
#include "ecat_core/sim_backend.hpp"

#ifdef ECAT_HAS_SOEM
#include "ecat_core/soem_backend.hpp"
#endif

#ifdef _WIN32
#include <windows.h>

#include <filesystem>
#include <vector>

namespace {

bool load_npcap_runtime(std::string& failure) {
  std::vector<std::filesystem::path> candidates;
  const auto override_path = [] {
    std::string value;
    const DWORD length = GetEnvironmentVariableA("ECAT_NPCAP_DIR", nullptr, 0);
    if (length > 1) {
      value.resize(length);
      GetEnvironmentVariableA("ECAT_NPCAP_DIR", value.data(), length);
      while (!value.empty() && value.back() == '\0') {
        value.pop_back();
      }
    }
    return value;
  }();
  if (!override_path.empty()) {
    candidates.emplace_back(
        std::filesystem::path(override_path) / "wpcap.dll");
  }

  std::vector<wchar_t> executable_path(32768);
  const DWORD executable_length =
      GetModuleFileNameW(nullptr, executable_path.data(),
                         static_cast<DWORD>(executable_path.size()));
  if (executable_length > 0 && executable_length < executable_path.size()) {
    candidates.emplace_back(
        std::filesystem::path(
            std::wstring(executable_path.data(), executable_length))
            .parent_path() /
        "wpcap.dll");
  }

  std::vector<wchar_t> system_directory(MAX_PATH);
  const UINT system_length =
      GetSystemDirectoryW(system_directory.data(),
                          static_cast<UINT>(system_directory.size()));
  if (system_length > 0 && system_length < system_directory.size()) {
    candidates.emplace_back(
        std::filesystem::path(
            std::wstring(system_directory.data(), system_length)) /
        "Npcap" / "wpcap.dll");
  }

  constexpr DWORD kSearchFlags =
      LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR |
      LOAD_LIBRARY_SEARCH_DEFAULT_DIRS;
  for (const auto& candidate : candidates) {
    if (!std::filesystem::is_regular_file(candidate)) {
      continue;
    }
    if (LoadLibraryExW(candidate.c_str(), nullptr, kSearchFlags) != nullptr) {
      return true;
    }
  }
  if (LoadLibraryW(L"wpcap.dll") != nullptr) {
    return true;
  }
  failure =
      "Npcap runtime was not found. Install Npcap or set ECAT_NPCAP_DIR to "
      "the directory containing wpcap.dll.";
  return false;
}

}  // namespace
#endif

int main(int argc, char** argv) {
  std::string mode = "sim";
  for (int index = 1; index < argc; ++index) {
    const std::string argument = argv[index];
    if (argument == "--mode" && index + 1 < argc) {
      mode = argv[++index];
    }
  }

  std::unique_ptr<ecat::MasterBackend> backend;
  if (mode == "sim" || mode == "simulator") {
    backend = std::make_unique<ecat::SimBackend>();
  } else if (mode == "soem") {
#ifdef ECAT_HAS_SOEM
#ifdef _WIN32
    std::string npcap_failure;
    if (!load_npcap_runtime(npcap_failure)) {
      std::cerr << npcap_failure << '\n';
      return 3;
    }
#endif
    backend = std::make_unique<ecat::SoemBackend>();
#else
    std::cerr << "This build does not include the SOEM backend.\n";
    return 2;
#endif
  } else {
    std::cerr << "Unknown core mode: " << mode << '\n';
    return 2;
  }

  ecat::JsonLineService service(std::move(backend));
  return service.run();
}
