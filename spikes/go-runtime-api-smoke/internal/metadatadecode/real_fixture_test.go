package metadatadecode

import (
	"encoding/hex"
	"errors"
	"os"
	"strings"
	"testing"
)

func TestDecodeRuntimeAPIsRejectsRealV14Fixture(t *testing.T) {
	metadata := readHexFixture(t, "testdata/polkadot_asset_hub_runtime_metadata_v14.hex")

	if len(metadata) < 5 {
		t.Fatalf("fixture len = %d, want at least 5 bytes", len(metadata))
	}
	if string(metadata[:4]) != "meta" {
		t.Fatalf("fixture magic = %q, want %q", metadata[:4], "meta")
	}
	if metadata[4] != 14 {
		t.Fatalf("fixture metadata version = %d, want 14", metadata[4])
	}

	_, err := DecodeRuntimeAPIs(metadata)
	if !errors.Is(err, ErrUnsupportedMetadataVersion) {
		t.Fatalf("DecodeRuntimeAPIs() error = %v, want ErrUnsupportedMetadataVersion", err)
	}
}

func readHexFixture(t *testing.T, path string) []byte {
	t.Helper()

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile(%q) error = %v", path, err)
	}

	hexText := strings.TrimPrefix(strings.TrimSpace(string(raw)), "0x")
	decoded, err := hex.DecodeString(hexText)
	if err != nil {
		t.Fatalf("DecodeString(%q) error = %v", path, err)
	}
	return decoded
}
