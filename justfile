default:
  @just --list

install:
  npm ci

build:
  npm run build

build-wasm:
  npm run build:wasm

lint:
  npm run lint

fmt-check:
  npm run fmt:check

fmt:
  npm run fmt

test:
  npm test

check:
  npm run check

ci:
  npm ci
  npm run check
  npm run pack:worker
