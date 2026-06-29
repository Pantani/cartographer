package rpccall

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	// DryRunCallMethod is the runtime API method name this spike must prove before live support.
	DryRunCallMethod = "DryRunApi_dry_run_call"
	// QueryXCMWeightMethod is the XCM payment runtime API method name this spike must prove.
	QueryXCMWeightMethod = "XcmPaymentApi_query_xcm_weight"
	// QueryAcceptablePaymentAssetsMethod is the XCM payment-assets runtime API method name this spike must prove.
	QueryAcceptablePaymentAssetsMethod = "XcmPaymentApi_query_acceptable_payment_assets"
	// QueryWeightToAssetFeeMethod is the weight-to-asset-fee runtime API method name this spike must prove.
	QueryWeightToAssetFeeMethod = "XcmPaymentApi_query_weight_to_asset_fee"

	defaultResultXCMVersion = 4
)

// Config captures the live-smoke inputs; it performs no network validation.
type Config struct {
	RPC              string
	Account          string
	CallHex          string
	ResultXCMVersion int
}

// RuntimeCallEvidence records the attempted runtime API method and why it is blocked.
type RuntimeCallEvidence struct {
	Method string `json:"method"`
	Status string `json:"status"`
	RawHex string `json:"rawHex,omitempty"`
	Error  string `json:"error,omitempty"`
}

// RuntimeCaller defines the runtime API boundary without committing to a live RPC implementation.
type RuntimeCaller interface {
	CallRuntime(config Config) ([]RuntimeCallEvidence, error)
}

// BlockedRuntimeCaller emits blocked evidence until SCALE args and the call path are verified.
type BlockedRuntimeCaller struct{}

// ConfigFromEnv parses required live-smoke environment values from a supplied map.
func ConfigFromEnv(env map[string]string) (Config, error) {
	missing := missingRequiredEnv(env)
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required env: %s", strings.Join(missing, ", "))
	}

	version, err := resultXCMVersion(env)
	if err != nil {
		return Config{}, err
	}

	return Config{
		RPC:              env["CARTOGRAPHER_IT_RPC"],
		Account:          env["CARTOGRAPHER_IT_ACCOUNT"],
		CallHex:          env["CARTOGRAPHER_IT_CALL"],
		ResultXCMVersion: version,
	}, nil
}

// CallRuntime returns blocked evidence for every method that still needs live proof.
func (BlockedRuntimeCaller) CallRuntime(Config) ([]RuntimeCallEvidence, error) {
	methods := []string{
		DryRunCallMethod,
		QueryXCMWeightMethod,
		QueryAcceptablePaymentAssetsMethod,
		QueryWeightToAssetFeeMethod,
	}

	evidence := make([]RuntimeCallEvidence, 0, len(methods))
	for _, method := range methods {
		evidence = append(evidence, RuntimeCallEvidence{
			Method: method,
			Status: "blocked",
			Error:  "TODO(verify: SCALE args and runtime API call path are not proven for " + method + ")",
		})
	}
	return evidence, nil
}

func missingRequiredEnv(env map[string]string) []string {
	required := []string{
		"CARTOGRAPHER_IT_RPC",
		"CARTOGRAPHER_IT_ACCOUNT",
		"CARTOGRAPHER_IT_CALL",
	}

	var missing []string
	for _, name := range required {
		if strings.TrimSpace(env[name]) == "" {
			missing = append(missing, name)
		}
	}
	return missing
}

func resultXCMVersion(env map[string]string) (int, error) {
	value, ok := env["CARTOGRAPHER_IT_RESULT_XCM_VERSION"]
	if !ok || strings.TrimSpace(value) == "" {
		return defaultResultXCMVersion, nil
	}

	version, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("CARTOGRAPHER_IT_RESULT_XCM_VERSION must be 2, 3, 4, or 5")
	}
	if version < 2 || version > 5 || strconv.Itoa(version) != value {
		return 0, fmt.Errorf("CARTOGRAPHER_IT_RESULT_XCM_VERSION must be 2, 3, 4, or 5")
	}
	return version, nil
}
