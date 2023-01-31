TESTARGS ?= test/

build: 
	@rm -rf dist || true
	@mkdir -p dist
	@yarn run build

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
	@node_modules/.bin/jest --forceExit --detectOpenHandles --coverage --verbose $(TESTARGS)

.PHONY: build lint lint-fix install start test
