package rpccall

import (
	"strings"
	"testing"
)

func TestConfigFromEnvRequiresCoreInputs(t *testing.T) {
	_, err := ConfigFromEnv(map[string]string{})
	if err == nil {
		t.Fatal("ConfigFromEnv returned nil error")
	}

	for _, name := range []string{
		"CARTOGRAPHER_IT_RPC",
		"CARTOGRAPHER_IT_ACCOUNT",
		"CARTOGRAPHER_IT_CALL",
	} {
		if !strings.Contains(err.Error(), name) {
			t.Fatalf("ConfigFromEnv error %q does not mention %s", err, name)
		}
	}
}

func TestConfigFromEnvParsesInputsWithDefaultResultXCMVersion(t *testing.T) {
	cfg, err := ConfigFromEnv(map[string]string{
		"CARTOGRAPHER_IT_RPC":     "wss://example.test",
		"CARTOGRAPHER_IT_ACCOUNT": "5Alice",
		"CARTOGRAPHER_IT_CALL":    "0x1234",
	})
	if err != nil {
		t.Fatalf("ConfigFromEnv returned error: %v", err)
	}
	if cfg.RPC != "wss://example.test" || cfg.Account != "5Alice" || cfg.CallHex != "0x1234" {
		t.Fatalf("unexpected config: %#v", cfg)
	}
	if cfg.ResultXCMVersion != 4 {
		t.Fatalf("ResultXCMVersion = %d, want 4", cfg.ResultXCMVersion)
	}
}

func TestConfigFromEnvTreatsEmptyResultXCMVersionAsDefault(t *testing.T) {
	cfg, err := ConfigFromEnv(map[string]string{
		"CARTOGRAPHER_IT_RPC":                "wss://example.test",
		"CARTOGRAPHER_IT_ACCOUNT":            "5Alice",
		"CARTOGRAPHER_IT_CALL":               "0x1234",
		"CARTOGRAPHER_IT_RESULT_XCM_VERSION": "",
	})
	if err != nil {
		t.Fatalf("ConfigFromEnv returned error: %v", err)
	}
	if cfg.ResultXCMVersion != 4 {
		t.Fatalf("ResultXCMVersion = %d, want 4", cfg.ResultXCMVersion)
	}
}

func TestConfigFromEnvAcceptsPinnedResultXCMVersions(t *testing.T) {
	for _, version := range []string{"2", "3", "4", "5"} {
		cfg, err := ConfigFromEnv(map[string]string{
			"CARTOGRAPHER_IT_RPC":                "wss://example.test",
			"CARTOGRAPHER_IT_ACCOUNT":            "5Alice",
			"CARTOGRAPHER_IT_CALL":               "0x1234",
			"CARTOGRAPHER_IT_RESULT_XCM_VERSION": version,
		})
		if err != nil {
			t.Fatalf("ConfigFromEnv version %s returned error: %v", version, err)
		}
		if got := cfg.ResultXCMVersion; got != int(version[0]-'0') {
			t.Fatalf("ResultXCMVersion = %d, want %s", got, version)
		}
	}
}

func TestConfigFromEnvRejectsUnsupportedResultXCMVersions(t *testing.T) {
	for _, version := range []string{"1", "6", "latest", "04"} {
		_, err := ConfigFromEnv(map[string]string{
			"CARTOGRAPHER_IT_RPC":                "wss://example.test",
			"CARTOGRAPHER_IT_ACCOUNT":            "5Alice",
			"CARTOGRAPHER_IT_CALL":               "0x1234",
			"CARTOGRAPHER_IT_RESULT_XCM_VERSION": version,
		})
		if err == nil {
			t.Fatalf("ConfigFromEnv version %q returned nil error", version)
		}
	}
}

func TestRuntimeAPIMethodNames(t *testing.T) {
	tests := map[string]string{
		"dry-run call":              DryRunCallMethod,
		"query xcm weight":          QueryXCMWeightMethod,
		"query payment assets":      QueryAcceptablePaymentAssetsMethod,
		"query weight to asset fee": QueryWeightToAssetFeeMethod,
	}

	want := map[string]string{
		"dry-run call":              "DryRunApi_dry_run_call",
		"query xcm weight":          "XcmPaymentApi_query_xcm_weight",
		"query payment assets":      "XcmPaymentApi_query_acceptable_payment_assets",
		"query weight to asset fee": "XcmPaymentApi_query_weight_to_asset_fee",
	}

	for name, got := range tests {
		if got != want[name] {
			t.Fatalf("%s method = %q, want %q", name, got, want[name])
		}
	}
}

func TestBlockedRuntimeCallerReturnsTODOEvidenceForAllMethods(t *testing.T) {
	var caller RuntimeCaller = BlockedRuntimeCaller{}
	got, err := caller.CallRuntime(Config{
		RPC:              "wss://example.test",
		Account:          "5Alice",
		CallHex:          "0x1234",
		ResultXCMVersion: 4,
	})
	if err != nil {
		t.Fatalf("CallRuntime returned error: %v", err)
	}

	wantMethods := []string{
		DryRunCallMethod,
		QueryXCMWeightMethod,
		QueryAcceptablePaymentAssetsMethod,
		QueryWeightToAssetFeeMethod,
	}
	if len(got) != len(wantMethods) {
		t.Fatalf("evidence count = %d, want %d: %#v", len(got), len(wantMethods), got)
	}

	for i, wantMethod := range wantMethods {
		if got[i].Method != wantMethod {
			t.Fatalf("evidence[%d].Method = %q, want %q", i, got[i].Method, wantMethod)
		}
		if got[i].Status != "blocked" {
			t.Fatalf("evidence[%d].Status = %q, want blocked", i, got[i].Status)
		}
		if !strings.Contains(got[i].Error, "TODO(verify:") {
			t.Fatalf("evidence[%d].Error = %q, want TODO(verify:) marker", i, got[i].Error)
		}
	}
}
