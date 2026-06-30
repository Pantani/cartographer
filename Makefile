.PHONY: help infra-up check xcm-test xcm-cli test-live evidence-fixture lint-fix

help:
	@printf '%s\n' \
		'Cartographer commands:' \
		'  make infra-up   Install deps, build, and prove the integration harness' \
		'  make check      Run local lint/typecheck/test/coverage/depcheck/build gates' \
		'  make xcm-test   Run live DryRunApi/XcmPaymentApi evidence test' \
		'  make xcm-cli    Run the built trace CLI with live env vars' \
		'  make test-live  Run all live integration tests with required env vars' \
		'  make evidence-fixture INPUT=path  Generate fixture module from scrubbed evidence' \
		'  make lint-fix   Run ESLint auto-fix'

infra-up:
	CI=true pnpm install --frozen-lockfile
	pnpm run infra:up

check:
	pnpm run check

xcm-test:
	pnpm run xcm:test

xcm-cli:
	pnpm run xcm:cli

test-live:
	pnpm run test:live

evidence-fixture:
	@pnpm --silent run evidence:fixture -- $(INPUT)

lint-fix:
	pnpm lint:fix
