package acceptableassets

import (
	"encoding/binary"
	"encoding/hex"
	"fmt"
)

const (
	// QueryAcceptablePaymentAssetsMethod is the runtime API method this package prepares candidate args for.
	QueryAcceptablePaymentAssetsMethod = "XcmPaymentApi_query_acceptable_payment_assets"

	minCandidateVersion = 2
	maxCandidateVersion = 5
)

// CandidateRuntimeCall is transport input only; it does not prove runtime API support.
type CandidateRuntimeCall struct {
	Method  string
	ArgsHex string
}

// BuildCandidateArgsHex returns candidate SCALE args hex for one pinned xcm_version value.
func BuildCandidateArgsHex(xcmVersion int) (string, error) {
	if xcmVersion < minCandidateVersion || xcmVersion > maxCandidateVersion {
		return "", fmt.Errorf("xcm_version must be 2, 3, 4, or 5")
	}

	var encoded [4]byte
	binary.LittleEndian.PutUint32(encoded[:], uint32(xcmVersion))
	return "0x" + hex.EncodeToString(encoded[:]), nil
}

// BuildCandidateRuntimeCall returns method and args for raw state_call transport input only.
func BuildCandidateRuntimeCall(xcmVersion int) (CandidateRuntimeCall, error) {
	argsHex, err := BuildCandidateArgsHex(xcmVersion)
	if err != nil {
		return CandidateRuntimeCall{}, err
	}

	return CandidateRuntimeCall{
		Method:  QueryAcceptablePaymentAssetsMethod,
		ArgsHex: argsHex,
	}, nil
}
