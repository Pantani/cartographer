package acceptableassets

import "testing"

func TestBuildCandidateArgsHexAcceptsPinnedVersions(t *testing.T) {
	tests := map[int]string{
		2: "0x02000000",
		3: "0x03000000",
		4: "0x04000000",
		5: "0x05000000",
	}

	for version, want := range tests {
		got, err := BuildCandidateArgsHex(version)
		if err != nil {
			t.Fatalf("BuildCandidateArgsHex(%d) returned error: %v", version, err)
		}
		if got != want {
			t.Fatalf("BuildCandidateArgsHex(%d) = %q, want %q", version, got, want)
		}
	}
}

func TestBuildCandidateArgsHexRejectsInvalidVersions(t *testing.T) {
	tests := []int{-1, 0, 1, 6}

	for _, version := range tests {
		if _, err := BuildCandidateArgsHex(version); err == nil {
			t.Fatalf("BuildCandidateArgsHex(%d) returned nil error", version)
		}
	}
}

func TestBuildCandidateRuntimeCallUsesAcceptableAssetsMethod(t *testing.T) {
	got, err := BuildCandidateRuntimeCall(4)
	if err != nil {
		t.Fatalf("BuildCandidateRuntimeCall returned error: %v", err)
	}
	if got.Method != QueryAcceptablePaymentAssetsMethod {
		t.Fatalf("Method = %q, want %q", got.Method, QueryAcceptablePaymentAssetsMethod)
	}
	if got.ArgsHex != "0x04000000" {
		t.Fatalf("ArgsHex = %q, want %q", got.ArgsHex, "0x04000000")
	}
}
