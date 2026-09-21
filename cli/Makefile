# nah — command line and terminal UI for NICE-API'HUB
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
COMMIT  ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo none)
DATE    ?= $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
LDFLAGS := -s -w -X main.version=$(VERSION) -X main.commit=$(COMMIT) -X main.date=$(DATE)
TARGETS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64

.PHONY: build test race vet install dist clean
build:            ## build ./bin/nah for this machine
	go build -trimpath -ldflags "$(LDFLAGS)" -o bin/nah .

test:             ## run the tests
	go test -count=1 ./...

race:             ## run the tests with the race detector
	go test -race -count=1 ./...

vet:
	go vet ./...

install:          ## install into $GOBIN (or ~/go/bin)
	go install -trimpath -ldflags "$(LDFLAGS)" .

dist:             ## cross-compile every release binary + SHA256SUMS into ./dist
	@rm -rf dist && mkdir -p dist
	@for t in $(TARGETS); do \
	  os=$${t%/*}; arch=$${t#*/}; ext=""; [ $$os = windows ] && ext=".exe"; \
	  echo "building $$os/$$arch"; \
	  CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -trimpath -ldflags "$(LDFLAGS)" -o dist/nah-$$os-$$arch$$ext . || exit 1; \
	done
	@cd dist && sha256sum nah-* > SHA256SUMS && echo && cat SHA256SUMS

clean:
	rm -rf bin dist
