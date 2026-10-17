# DeviceHub C Protocol Library — Copyright © 2026 Parsa Fathi — Apache-2.0
#
# Targets:
#   all        build the static library and the test binary
#   test       run the test suite (output also saved to tests/test_output.txt)
#   test-asan  rebuild with -fsanitize=address,undefined and run the tests
#   clean      remove build artifacts

CC        := gcc
AR        := ar
CFLAGS    := -std=c11 -Wall -Wextra -Werror -O2
ASANFLAGS := -std=c11 -Wall -Wextra -Werror -O1 -g \
             -fsanitize=address,undefined -fno-omit-frame-pointer
INCLUDES  := -Iinclude

BUILD      := build
BUILD_ASAN := build-asan

LIB           := $(BUILD)/libdh_protocol.a
TEST_BIN      := $(BUILD)/test_protocol
ASAN_LIB      := $(BUILD_ASAN)/libdh_protocol.a
ASAN_TEST_BIN := $(BUILD_ASAN)/test_protocol

.PHONY: all test test-asan clean

all: $(LIB) $(TEST_BIN)

$(BUILD) $(BUILD_ASAN):
	mkdir -p $@

$(BUILD)/dh_protocol.o: src/dh_protocol.c include/dh_protocol.h | $(BUILD)
	$(CC) $(CFLAGS) $(INCLUDES) -c $< -o $@

$(LIB): $(BUILD)/dh_protocol.o
	$(AR) rcs $@ $^

$(TEST_BIN): tests/test_protocol.c $(LIB)
	$(CC) $(CFLAGS) $(INCLUDES) $< $(LIB) -lm -o $@

test: $(TEST_BIN)
	@$(TEST_BIN) > tests/test_output.txt 2>&1; rc=$$?; cat tests/test_output.txt; exit $$rc

$(BUILD_ASAN)/dh_protocol.o: src/dh_protocol.c include/dh_protocol.h | $(BUILD_ASAN)
	$(CC) $(ASANFLAGS) $(INCLUDES) -c $< -o $@

$(ASAN_LIB): $(BUILD_ASAN)/dh_protocol.o
	$(AR) rcs $@ $^

$(ASAN_TEST_BIN): tests/test_protocol.c $(ASAN_LIB)
	$(CC) $(ASANFLAGS) $(INCLUDES) $< $(ASAN_LIB) -lm -o $@

test-asan: $(ASAN_TEST_BIN)
	$(ASAN_TEST_BIN)

clean:
	rm -rf $(BUILD) $(BUILD_ASAN)
