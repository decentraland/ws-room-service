src/proto/ws-comms-rfc-5.gen.ts: node_modules/@dcl/protocol/proto/decentraland/kernel/comms/rfc5/ws_comms.proto
	mkdir -p src/proto
	node_modules/.bin/protoc \
		--plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=esModuleInterop=true,returnObservable=false,outputServices=generic-definitions,oneof=unions \
		--ts_proto_opt=fileSuffix=.gen \
		--ts_proto_out="$(PWD)/src/proto" \
		-I="$(PWD)/node_modules/@dcl/protocol/proto/decentraland/kernel/comms/rfc5" \
		"$(PWD)/node_modules/@dcl/protocol/proto/decentraland/kernel/comms/rfc5/ws_comms.proto"

src/proto/archipelago.gen.ts: node_modules/@dcl/protocol/proto/decentraland/kernel/comms/v3/archipelago.proto
	mkdir -p src/proto
	node_modules/.bin/protoc \
		--plugin=./node_modules/.bin/protoc-gen-ts_proto \
		--ts_proto_opt=esModuleInterop=true,returnObservable=false,outputServices=generic-definitions,oneof=unions \
		--ts_proto_opt=fileSuffix=.gen \
		--ts_proto_out="$(PWD)/src/proto" \
		-I="$(PWD)/node_modules/@dcl/protocol/proto/decentraland/kernel/comms/v3" \
		"$(PWD)/node_modules/@dcl/protocol/proto/decentraland/kernel/comms/v3/archipelago.proto"

build: src/proto/archipelago.gen.ts src/proto/ws_comms.gen.ts
	@rm -rf dist || true
	@mkdir -p dist
	@./node_modules/.bin/tsc -p tsconfig.json

lint:
	@node_modules/.bin/eslint . --ext .ts

lint-fix: ## Fix bad formatting on all .ts and .tsx files
	@node_modules/.bin/eslint . --ext .ts --fix

install:
	npm ci

profile: build
	node \
		--trace-warnings \
		--abort-on-uncaught-exception \
		--unhandled-rejections=strict \
		--inspect \
		dist/index.js

start: build
	npm run start

test:
	npm run test

.PHONY: build lint lint-fix install start test
