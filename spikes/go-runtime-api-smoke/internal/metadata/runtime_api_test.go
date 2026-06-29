package metadata

import (
	"reflect"
	"testing"
)

func TestParseStateCallNameSplitsAPIAndMethod(t *testing.T) {
	got, err := ParseStateCallName(" XcmPaymentApi_query_acceptable_payment_assets ")
	if err != nil {
		t.Fatalf("ParseStateCallName returned error: %v", err)
	}

	want := RuntimeAPIMethodName{
		API:           "XcmPaymentApi",
		Method:        "query_acceptable_payment_assets",
		StateCallName: "XcmPaymentApi_query_acceptable_payment_assets",
	}
	if got != want {
		t.Fatalf("ParseStateCallName() = %#v, want %#v", got, want)
	}
}

func TestParseStateCallNameRejectsMalformedNames(t *testing.T) {
	for _, input := range []string{"", "XcmPaymentApi", "_query_xcm_weight", "XcmPaymentApi_"} {
		if _, err := ParseStateCallName(input); err == nil {
			t.Fatalf("ParseStateCallName(%q) returned nil error", input)
		}
	}
}

func TestLocateRuntimeAPIMethodProjectsTypeIDs(t *testing.T) {
	apis := []RuntimeAPI{
		{
			Name: "DryRunApi",
			Methods: []RuntimeAPIMethod{
				{
					Name:         "dry_run_call",
					Inputs:       []RuntimeAPIParam{{Name: "origin", TypeID: 10}},
					OutputTypeID: 99,
				},
			},
		},
		{
			Name: "XcmPaymentApi",
			Methods: []RuntimeAPIMethod{
				{
					Name: "query_acceptable_payment_assets",
					Inputs: []RuntimeAPIParam{
						{Name: "xcm_version", TypeID: 42},
					},
					OutputTypeID: 77,
				},
			},
		},
	}

	got, ok, err := LocateRuntimeAPIMethod(apis, "XcmPaymentApi_query_acceptable_payment_assets")
	if err != nil {
		t.Fatalf("LocateRuntimeAPIMethod returned error: %v", err)
	}
	if !ok {
		t.Fatal("LocateRuntimeAPIMethod did not find fixture method")
	}

	want := RuntimeAPIMethodLocation{
		RuntimeAPIMethodName: RuntimeAPIMethodName{
			API:           "XcmPaymentApi",
			Method:        "query_acceptable_payment_assets",
			StateCallName: "XcmPaymentApi_query_acceptable_payment_assets",
		},
		Inputs:       []RuntimeAPIParam{{Name: "xcm_version", TypeID: 42}},
		OutputTypeID: 77,
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("LocateRuntimeAPIMethod() = %#v, want %#v", got, want)
	}
}

func TestLocateRuntimeAPIMethodReturnsFalseForMissingMethod(t *testing.T) {
	apis := []RuntimeAPI{
		{
			Name: "XcmPaymentApi",
			Methods: []RuntimeAPIMethod{
				{Name: "query_xcm_weight", OutputTypeID: 12},
			},
		},
	}

	got, ok, err := LocateRuntimeAPIMethod(apis, "XcmPaymentApi_query_acceptable_payment_assets")
	if err != nil {
		t.Fatalf("LocateRuntimeAPIMethod returned error: %v", err)
	}
	if ok {
		t.Fatalf("LocateRuntimeAPIMethod returned ok with %#v", got)
	}
}
