SHELL := /bin/sh

.PHONY: up down test lint secure typecheck config-dev config-staging config-prod

up:
	npm install
	npx expo start --clear

down:
	npx --yes kill-port 8081 19000 19001 19002 || true
	@echo "Stopped common Metro/Expo development ports if they were active."

test:
	npm test

lint:
	npm run typecheck
	npm run lint

secure:
	npm audit --audit-level=moderate
	npx --yes trufflehog filesystem . --fail --no-update
	npx --yes semgrep scan --config p/owasp-top-ten --config p/secrets --error

typecheck:
	npm run typecheck

config-dev:
	npm run config:dev

config-staging:
	npm run config:staging

config-prod:
	npm run config:prod
