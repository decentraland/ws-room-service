PROTOBUF_VERSION = 3.19.1
UNAME := $(shell uname)

ifeq ($(UNAME),Darwin)
PROTOBUF_ZIP = protoc-$(PROTOBUF_VERSION)-osx-x86_64.zip
else
PROTOBUF_ZIP = protoc-$(PROTOBUF_VERSION)-linux-x86_64.zip
endif

protoc3/bin/protoc:
	@# remove local folder
	rm -rf protoc3 || true

	@# Make sure you grab the latest version
	curl -OL https://github.com/protocolbuffers/protobuf/releases/download/v$(PROTOBUF_VERSION)/$(PROTOBUF_ZIP)

	@# Unzip
	unzip $(PROTOBUF_ZIP) -d protoc3
	@# delete the files
	rm $(PROTOBUF_ZIP)

	@# move protoc to /usr/local/bin/
	chmod +x protoc3/bin/protoc

src/proto/ws-comms-rfc-5.gen.ts: protoc3/bin/protoc node_modules/@dcl/protocol/kernel/comms/ws-comms-rfc-5.proto
	mkdir -p src/proto
	protoc3/bin/protoc \
		--plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=esModuleInterop=true,returnObservable=false,outputServices=generic-definitions,oneof=unions \
		--ts_proto_opt=fileSuffix=.gen \
		--ts_proto_out="$(PWD)/src/proto" \
		-I="$(PWD)/node_modules/@dcl/protocol/kernel/comms" \
		"$(PWD)/node_modules/@dcl/protocol/kernel/comms/ws-comms-rfc-5.proto"

src/proto/archipelago.gen.ts: protoc3/bin/protoc node_modules/@dcl/protocol/kernel/comms/v3/archipelago.proto
	mkdir -p src/proto
	protoc3/bin/protoc \
		--plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=esModuleInterop=true,returnObservable=false,outputServices=generic-definitions,oneof=unions \
		--ts_proto_opt=fileSuffix=.gen \
		--ts_proto_out="$(PWD)/src/proto" \
		-I="$(PWD)/node_modules/@dcl/protocol/kernel/comms/v3" \
		"$(PWD)/node_modules/@dcl/protocol/kernel/comms/v3/archipelago.proto"

build: src/proto/archipelago.gen.ts src/proto/ws-comms-rfc-5.gen.ts
	@rm -rf dist || true
	@mkdir -p dist
	@./node_modules/.bin/tsc -p tsconfig.json

lint:
	@node_modules/.bin/eslint . --ext .ts

lint-fix: ## Fix bad formatting on all .ts and .tsx files
	@node_modules/.bin/eslint . --ext .ts --fix

install:
	npm ci

.PHONY: build lint lint-fix install
