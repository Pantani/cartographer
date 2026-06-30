.PHONY: help infra-up infra-status infra-down check xcm-send xcm-test xcm-cli test-live live-xcm-test live-xcm-cli evidence-fixture lint-fix

help:
	@printf '%s\n' \
		'Cartographer commands:' \
		'  make infra-up      Install deps and start local Chopsticks XCM infra' \
		'  make infra-status  Show local Chopsticks endpoints, process, and health' \
		'  make infra-down    Stop tracked local Chopsticks infra and keep evidence' \
		'  make check      Run local lint/typecheck/test/coverage/depcheck/build gates' \
		'  make xcm-send      Submit generated/configured XCM test call to local Chopsticks' \
		'  make xcm-test      Validate local XCM evidence from Chopsticks' \
		'  make xcm-cli       Run the built trace CLI against local Chopsticks' \
		'  make test-live  Run all live integration tests with required env vars' \
		'  make evidence-fixture INPUT=path  Generate fixture module from scrubbed evidence' \
		'  make live-xcm-test Run live RPC DryRunApi/XcmPaymentApi evidence test' \
		'  make live-xcm-cli  Run the built trace CLI with live env vars' \
		'  make lint-fix   Run ESLint auto-fix'

infra-up:
	CI=true pnpm install --frozen-lockfile
	pnpm run infra:up

infra-status:
	pnpm run infra:status

infra-down:
	pnpm run infra:down

check:
	pnpm run check

xcm-send:
	pnpm run xcm:send

xcm-test:
	pnpm run xcm:test

xcm-cli:
	pnpm run xcm:cli

test-live:
	pnpm run test:live

live-xcm-test:
	pnpm run live:xcm:test

live-xcm-cli:
	pnpm run live:xcm:cli

evidence-fixture:
	@pnpm --silent run evidence:fixture -- $(INPUT)

lint-fix:
	pnpm lint:fix
