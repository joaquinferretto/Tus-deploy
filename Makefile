.PHONY: help install up down test lint secure clean local-up local-down

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

install: ## Install dependencies
	pnpm install

up: ## Start development environment
	docker compose up --build
	@echo "✅ Backend running at http://localhost:3001"
	@echo "✅ Frontend: Run 'pnpm --filter web dev' (will be at http://localhost:3000)"

down: ## Stop development environment
	docker compose down --remove-orphans

local-up: up ## Start the complete provider-free local profile

local-down: down ## Stop the complete provider-free local profile

test: ## Run all tests
	pnpm run test

lint: ## Run linters
	pnpm run lint

secure: ## Run security checks
	pnpm security:scan

clean: ## Clean up
	docker compose down -v
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/*/.next apps/*/dist
