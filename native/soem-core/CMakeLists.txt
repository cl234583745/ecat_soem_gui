cmake_minimum_required(VERSION 3.24)

project(ecat_core VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(ECAT_ENABLE_SOEM "Build the physical EtherCAT backend with SOEM" OFF)
set(ECAT_SOEM_ROOT
    "${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/SOEM"
    CACHE PATH "Path to the official SOEM source tree")
set(ECAT_NPCAP_ROOT
    ""
    CACHE PATH "Path to the Npcap SDK root containing Include and Lib/x64")

add_executable(ecat-core
  src/main.cpp
  src/json_line_service.cpp
  src/sim_backend.cpp
)

target_include_directories(ecat-core
  PRIVATE
    include
    "${CMAKE_CURRENT_SOURCE_DIR}/../../third_party/nlohmann-json/include"
)

target_compile_definitions(ecat-core PRIVATE
  ECAT_CORE_VERSION="${PROJECT_VERSION}"
  NOMINMAX
)

if(MSVC)
  target_compile_options(ecat-core PRIVATE /W4 /permissive- /EHsc)
  set_target_properties(ecat-core PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
  )
else()
  target_compile_options(ecat-core PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(WIN32)
  target_link_libraries(ecat-core PRIVATE ws2_32 winmm iphlpapi)
endif()

if(ECAT_ENABLE_SOEM)
  if(NOT EXISTS "${ECAT_SOEM_ROOT}/CMakeLists.txt")
    message(FATAL_ERROR
      "SOEM source was not found at ${ECAT_SOEM_ROOT}. "
      "Clone https://github.com/OpenEtherCATsociety/SOEM (v2.0.0) into third_party/SOEM "
      "or pass -DECAT_SOEM_ROOT=<path>.")
  endif()

  target_sources(ecat-core PRIVATE src/soem_backend.cpp)
  target_compile_definitions(ecat-core PRIVATE ECAT_HAS_SOEM=1)
  add_subdirectory("${ECAT_SOEM_ROOT}" "${CMAKE_BINARY_DIR}/soem" EXCLUDE_FROM_ALL)
  target_link_libraries(ecat-core PRIVATE soem)

  if(WIN32)
    if(NOT ECAT_NPCAP_ROOT)
      message(FATAL_ERROR
        "ECAT_NPCAP_ROOT is required for a physical Windows build. "
        "Install the Npcap SDK and pass -DECAT_NPCAP_ROOT=<path>.")
    endif()
    target_include_directories(ecat-core PRIVATE "${ECAT_NPCAP_ROOT}/Include")
    target_link_directories(ecat-core PRIVATE "${ECAT_NPCAP_ROOT}/Lib/x64")
    target_link_libraries(ecat-core PRIVATE wpcap Packet)
    if(MSVC)
      # Npcap may install its runtime DLLs under System32\Npcap instead of
      # System32. Delay loading lets the simulator start without Npcap and
      # lets the physical mode load the installed runtime explicitly.
      target_link_options(ecat-core PRIVATE /DELAYLOAD:wpcap.dll)
      target_link_libraries(ecat-core PRIVATE delayimp)
    endif()
  endif()
endif()

install(TARGETS ecat-core RUNTIME DESTINATION .)
