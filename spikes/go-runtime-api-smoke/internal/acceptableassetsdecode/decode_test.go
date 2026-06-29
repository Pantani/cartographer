package acceptableassetsdecode

import (
	"errors"
	"strings"
	"testing"
)

func TestDecodeReturnDecodesTypedErrors(t *testing.T) {
	tests := []struct {
		index byte
		name  string
	}{
		{index: 0, name: "Unimplemented"},
		{index: 1, name: "VersionedConversionFailed"},
		{index: 2, name: "WeightNotComputable"},
		{index: 3, name: "UnhandledXcmVersion"},
		{index: 4, name: "AssetNotFound"},
		{index: 5, name: "Unroutable"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := DecodeReturn([]byte{1, tt.index})
			if err != nil {
				t.Fatalf("DecodeReturn() error = %v", err)
			}
			if got.Status != StatusError {
				t.Fatalf("Status = %q, want %q", got.Status, StatusError)
			}
			if got.Error == nil {
				t.Fatal("Error = nil, want typed payment error")
			}
			if got.Error.Index != tt.index || got.Error.Name != tt.name {
				t.Fatalf("Error = %+v, want index %d name %q", *got.Error, tt.index, tt.name)
			}
			if len(got.Assets) != 0 {
				t.Fatalf("Assets len = %d, want 0", len(got.Assets))
			}
		})
	}
}

func TestDecodeReturnDecodesEmptyOkVector(t *testing.T) {
	got, err := DecodeReturn([]byte{0, 0})
	if err != nil {
		t.Fatalf("DecodeReturn() error = %v", err)
	}

	if got.Status != StatusOK {
		t.Fatalf("Status = %q, want %q", got.Status, StatusOK)
	}
	if got.AssetCount != 0 {
		t.Fatalf("AssetCount = %d, want 0", got.AssetCount)
	}
	if len(got.Assets) != 0 {
		t.Fatalf("Assets len = %d, want 0", len(got.Assets))
	}
}

func TestDecodeReturnDecodesSimpleV4HereAsset(t *testing.T) {
	got, err := DecodeReturn([]byte{
		0,    // Result::Ok
		4,    // Compact<u32> vec length = 1
		4,    // VersionedAssetId::V4
		0, 0, // Location { parents: 0, interior: Junctions::Here }
	})
	if err != nil {
		t.Fatalf("DecodeReturn() error = %v", err)
	}

	if got.Status != StatusOK {
		t.Fatalf("Status = %q, want %q", got.Status, StatusOK)
	}
	if got.AssetCount != 1 || len(got.Assets) != 1 {
		t.Fatalf("Asset count = %d len = %d, want 1", got.AssetCount, len(got.Assets))
	}

	asset := got.Assets[0]
	if asset.Version != 4 || asset.VersionTag != "V4" {
		t.Fatalf("Version = %d tag = %q, want V4", asset.Version, asset.VersionTag)
	}
	if asset.PayloadHex != "0x0000" {
		t.Fatalf("PayloadHex = %q, want 0x0000", asset.PayloadHex)
	}
	if asset.Decoded == nil {
		t.Fatal("Decoded = nil, want simple location evidence")
	}
	if asset.Decoded.Kind != "LocationHere" || asset.Decoded.Parents != 0 || asset.Decoded.Interior != "Here" {
		t.Fatalf("Decoded = %+v, want LocationHere parents 0 interior Here", *asset.Decoded)
	}
}

func TestDecodeReturnBoundsComplexLocationPayloadsInMultiAssetList(t *testing.T) {
	got, err := DecodeReturn([]byte{
		0, // Result::Ok
		8, // Compact<u32> vec length = 2

		5,     // VersionedAssetId::V5
		0,     // Location.parents = 0
		2,     // Junctions::X2
		4, 50, // Junction::PalletInstance(50)
		5, 1, 31, // Junction::GeneralIndex(1984), compact-encoded

		4,    // VersionedAssetId::V4
		0, 0, // Location { parents: 0, interior: Here }
	})
	if err != nil {
		t.Fatalf("DecodeReturn() error = %v", err)
	}

	if got.AssetCount != 2 || len(got.Assets) != 2 {
		t.Fatalf("Asset count = %d len = %d, want 2", got.AssetCount, len(got.Assets))
	}

	first := got.Assets[0]
	if first.VersionTag != "V5" {
		t.Fatalf("first VersionTag = %q, want V5", first.VersionTag)
	}
	if first.PayloadHex != "0x0002043205011f" {
		t.Fatalf("first PayloadHex = %q, want bounded V5 location payload", first.PayloadHex)
	}
	if first.Decoded == nil || first.Decoded.Interior != "X2" || len(first.Decoded.Junctions) != 2 {
		t.Fatalf("first Decoded = %+v, want X2 location evidence", first.Decoded)
	}
	if first.Decoded.Junctions[0].Kind != "PalletInstance" || first.Decoded.Junctions[0].Value != "50" {
		t.Fatalf("first junction 0 = %+v, want PalletInstance 50", first.Decoded.Junctions[0])
	}
	if first.Decoded.Junctions[1].Kind != "GeneralIndex" || first.Decoded.Junctions[1].Value != "1984" {
		t.Fatalf("first junction 1 = %+v, want GeneralIndex 1984", first.Decoded.Junctions[1])
	}

	second := got.Assets[1]
	if second.VersionTag != "V4" || second.PayloadHex != "0x0000" {
		t.Fatalf("second asset = %+v, want V4 Here", second)
	}
}

func TestDecodeReturnDecodesV3AbstractPayload(t *testing.T) {
	payload := append([]byte{1}, bytesOf(0xab, 32)...)
	data := append([]byte{0, 4, 3}, payload...)

	got, err := DecodeReturn(data)
	if err != nil {
		t.Fatalf("DecodeReturn() error = %v", err)
	}

	if got.AssetCount != 1 || len(got.Assets) != 1 {
		t.Fatalf("Asset count = %d len = %d, want 1", got.AssetCount, len(got.Assets))
	}
	asset := got.Assets[0]
	if asset.Version != 3 || asset.VersionTag != "V3" {
		t.Fatalf("Version = %d tag = %q, want V3", asset.Version, asset.VersionTag)
	}
	if asset.PayloadHex != "0x01"+strings.Repeat("ab", 32) {
		t.Fatalf("PayloadHex = %q, want v3 abstract raw payload", asset.PayloadHex)
	}
	if asset.Decoded == nil || asset.Decoded.Kind != "Abstract" {
		t.Fatalf("Decoded = %+v, want Abstract", asset.Decoded)
	}
}

func TestDecodeReturnRejectsMalformedAndTrailingData(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want string
	}{
		{name: "empty", data: nil, want: "short SCALE return"},
		{name: "unknown result tag", data: []byte{2}, want: "unknown Result tag"},
		{name: "unknown error", data: []byte{1, 6}, want: "unknown XcmPaymentApi Error index"},
		{name: "error trailing", data: []byte{1, 0, 0}, want: "trailing data"},
		{name: "ok empty trailing", data: []byte{0, 0, 0}, want: "trailing data"},
		{name: "unknown version", data: []byte{0, 4, 6}, want: "unknown VersionedAssetId index"},
		{name: "malformed location payload", data: []byte{0, 4, 5, 1, 2, 3, 4}, want: "invalid Option<NetworkId> discriminant"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := DecodeReturn(tt.data)
			if err == nil {
				t.Fatal("DecodeReturn() error = nil, want error")
			}
			if !strings.Contains(err.Error(), tt.want) {
				t.Fatalf("DecodeReturn() error = %v, want containing %q", err, tt.want)
			}
		})
	}
}

func TestDecodeReturnRejectsNilDataWithSentinel(t *testing.T) {
	_, err := DecodeReturn(nil)
	if !errors.Is(err, ErrMalformedReturn) {
		t.Fatalf("DecodeReturn() error = %v, want ErrMalformedReturn", err)
	}
}

func bytesOf(value byte, count int) []byte {
	out := make([]byte, count)
	for i := range out {
		out[i] = value
	}
	return out
}
