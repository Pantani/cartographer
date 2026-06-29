package metadatadecode

import "testing"

func TestDecodeRuntimeAPIsProjectsRealV16Fixture(t *testing.T) {
	metadata := readHexFixture(t, "testdata/polkadot_asset_hub_runtime_metadata_v16.hex")

	if len(metadata) < 5 {
		t.Fatalf("fixture len = %d, want at least 5 bytes", len(metadata))
	}
	if string(metadata[:4]) != "meta" {
		t.Fatalf("fixture magic = %q, want %q", metadata[:4], "meta")
	}
	if metadata[4] != 16 {
		t.Fatalf("fixture metadata version = %d, want 16", metadata[4])
	}

	projection, err := DecodeRuntimeAPIs(metadata)
	if err != nil {
		t.Fatalf("DecodeRuntimeAPIs() error = %v", err)
	}

	method, ok := FindRuntimeAPIMethod(projection, "XcmPaymentApi", "query_acceptable_payment_assets")
	if !ok {
		t.Fatal("FindRuntimeAPIMethod() did not locate XcmPaymentApi.query_acceptable_payment_assets")
	}
	if len(method.Params) != 1 {
		t.Fatalf("Params len = %d, want 1", len(method.Params))
	}
	if method.Params[0] != (RuntimeAPIParam{Name: "xcm_version", TypeID: 14}) {
		t.Fatalf("Param = %+v, want xcm_version type 14", method.Params[0])
	}
	if method.OutputTypeID != 1020 {
		t.Fatalf("OutputTypeID = %d, want 1020", method.OutputTypeID)
	}
}
