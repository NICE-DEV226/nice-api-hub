# nah — command line and terminal UI for NICE-API'HUB
#
# Releases are tagged "cli/vX.Y.Z" (the prefix keeps them apart from the API's tags, and is what `go install ...@cli/vX.Y.Z` expects).
VERSION ?= $(shell git describe --tags --match 'cli/v*' --always --dirty 2>/dev/null | sed 's#^cli/v##' || echo dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.date=$(DATE)
# Every platform we ship for. Cross-compiling is safe: the program is pure Go (CGO_ENABLED=0).
TARGETS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64 windows/arm64
SHA256  := $(shell command -v sha256sum >/dev/null 2>&1 && echo sha256sum || echo "shasum -a 256")

.PHONY: build test race vet fmt-check install dist clean
build:            ## build ./bin/nah for this machine
	go build -trimpath -ldflags "$(LDFLAGS)" -o bin/nah .

test:             ## run the tests
	go test -count=1 ./...

race:             ## run the tests with the race detector
	go test -race -count=1 ./...

vet:
	go vet ./...

fmt-check:        ## fail if any file needs gofmt
	@test -z "$$(gofmt -l .)" || { echo "needs gofmt:"; gofmt -l .; exit 1; }

install:          ## install into $GOBIN (or ~/go/bin)
	go install -trimpath -ldflags "$(LDFLAGS)" .

# dist builds a release archive per platform into ./dist, plus SHA256SUMS:
#   nah_<version>_<os>_<arch>.tar.gz  (Linux, macOS)   or   .zip  (Windows)
# each holding the program and the README. This is exactly what the release workflow publishes.
dist:             ## cross-compile every platform into release archives + SHA256SUMS in ./dist
	@rm -rf dist && mkdir -p dist
	@for t in $(TARGETS); do \
	  os=$${t%/*}; arch=$${t#*/}; ext=""; [ $$os = windows ] && ext=".exe"; \
	  name="nah_$(VERSION)_$${os}_$${arch}"; \
	  echo "building $$name"; \
	  mkdir -p "dist/$$name" && \
	  CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "$(LDFLAGS)" -o "dist/$$name/nah$$ext" . && \
	  cp README.md "dist/$$name/" || exit 1; \
	  if [ $$os = windows ]; then \
	    (cd dist && python3 -m zipfile -c "$$name.zip" "$$name") || exit 1; \
	  else \
	    tar -C dist -czf "dist/$$name.tar.gz" "$$name" || exit 1; \
	  fi; \
	  rm -rf "dist/$$name"; \
	done
	@cd dist && $(SHA256) *.tar.gz *.zip > SHA256SUMS && echo && cat SHA256SUMS

clean:
	rm -rf bin dist
