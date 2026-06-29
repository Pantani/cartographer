package metadatadecode

import (
	"encoding/binary"
	"errors"
	"testing"
)

func TestReadCompactU32DecodesAllDocumentedModes(t *testing.T) {
	tests := []struct {
		name string
		in   []byte
		want uint32
	}{
		{name: "single byte", in: []byte{0b11111100}, want: 63},
		{name: "two bytes", in: []byte{0b00000001, 0b00000001}, want: 64},
		{name: "four bytes", in: []byte{0b00000010, 0b00000000, 0b01000000, 0}, want: 1 << 20},
		{name: "big integer mode u32", in: []byte{0b00000011, 0x01, 0x02, 0x03, 0x04}, want: 0x04030201},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reader := NewReader(tt.in)

			got, err := reader.ReadCompactU32()
			if err != nil {
				t.Fatalf("ReadCompactU32() error = %v", err)
			}
			if got != tt.want {
				t.Fatalf("ReadCompactU32() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestDecodeRuntimeAPIsRejectsUnsupportedMetadataVersion(t *testing.T) {
	_, err := DecodeRuntimeAPIs(append(metadataEnvelope(14), 0))
	if !errors.Is(err, ErrUnsupportedMetadataVersion) {
		t.Fatalf("DecodeRuntimeAPIs() error = %v, want ErrUnsupportedMetadataVersion", err)
	}
}

func TestDecodeRuntimeAPIsProjectsV15RuntimeAPIMethods(t *testing.T) {
	metadata, err := DecodeRuntimeAPIs(v15SyntheticMetadata())
	if err != nil {
		t.Fatalf("DecodeRuntimeAPIs() error = %v", err)
	}

	if metadata.Version != 15 {
		t.Fatalf("Version = %d, want 15", metadata.Version)
	}

	method, ok := FindRuntimeAPIMethod(metadata, "XcmPaymentApi", "query_acceptable_payment_assets")
	if !ok {
		t.Fatal("FindRuntimeAPIMethod() did not locate method")
	}

	if method.OutputTypeID != 7 {
		t.Fatalf("OutputTypeID = %d, want 7", method.OutputTypeID)
	}
	if len(method.Params) != 1 {
		t.Fatalf("Params len = %d, want 1", len(method.Params))
	}
	if method.Params[0] != (RuntimeAPIParam{Name: "xcm_version", TypeID: 4}) {
		t.Fatalf("Param = %+v, want xcm_version type 4", method.Params[0])
	}
}

func TestDecodeRuntimeAPIsProjectsV16RuntimeAPIMethods(t *testing.T) {
	metadata, err := DecodeRuntimeAPIs(v16SyntheticMetadata())
	if err != nil {
		t.Fatalf("DecodeRuntimeAPIs() error = %v", err)
	}

	api := metadata.RuntimeAPIs[0]
	if api.Version == nil || *api.Version != 2 {
		t.Fatalf("Runtime API version = %v, want 2", api.Version)
	}

	method, ok := FindRuntimeAPIMethod(metadata, "XcmPaymentApi", "query_acceptable_payment_assets")
	if !ok {
		t.Fatal("FindRuntimeAPIMethod() did not locate method")
	}

	if method.OutputTypeID != 8 {
		t.Fatalf("OutputTypeID = %d, want 8", method.OutputTypeID)
	}
	if len(method.Params) != 1 || method.Params[0].TypeID != 5 {
		t.Fatalf("Params = %+v, want one type 5 param", method.Params)
	}
}

// These byte builders are synthetic fixtures for parser behavior only. They are
// shaped from frame-metadata v15/v16 struct field order but are not real chain
// metadata and must not be treated as live support evidence.
func v15SyntheticMetadata() []byte {
	out := metadataEnvelope(15)
	out = append(out, compact(0)...) // PortableRegistry.types
	out = append(out, compact(0)...) // pallets
	out = append(out, 4)             // extrinsic.version
	out = appendTypeIDs(out, 0, 1, 2, 3)
	out = append(out, compact(0)...) // signed_extensions
	out = appendTypeIDs(out, 99)     // runtime ty
	out = appendAPI(out, false, "XcmPaymentApi", "query_acceptable_payment_assets", 4, 7, 0)
	return out
}

func v16SyntheticMetadata() []byte {
	out := metadataEnvelope(16)
	out = append(out, compact(0)...) // PortableRegistry.types
	out = append(out, compact(0)...) // pallets
	out = append(out, compact(1)...) // extrinsic.versions
	out = append(out, 5)
	out = appendTypeIDs(out, 0, 1, 2) // address_ty, call_ty, signature_ty
	out = append(out, compact(0)...)  // transaction_extensions_by_version
	out = append(out, compact(0)...)  // transaction_extensions
	out = appendAPI(out, true, "XcmPaymentApi", "query_acceptable_payment_assets", 5, 8, 2)
	return out
}

func appendAPI(out []byte, v16 bool, apiName, methodName string, inputType, outputType, apiVersion uint32) []byte {
	out = append(out, compact(1)...)
	out = appendString(out, apiName)
	out = append(out, compact(1)...)
	out = appendString(out, methodName)
	out = append(out, compact(1)...)
	out = appendString(out, "xcm_version")
	out = appendTypeIDs(out, inputType)
	out = appendTypeIDs(out, outputType)
	out = append(out, compact(0)...) // method docs
	if v16 {
		out = append(out, 0) // method deprecation_info: NotDeprecated
	}
	out = append(out, compact(0)...) // API docs
	if v16 {
		out = append(out, compact(apiVersion)...)
		out = append(out, 0) // API deprecation_info: NotDeprecated
	}
	return out
}

func metadataEnvelope(version byte) []byte {
	return []byte{'m', 'e', 't', 'a', version}
}

func appendString(out []byte, value string) []byte {
	out = append(out, compact(uint32(len(value)))...)
	return append(out, []byte(value)...)
}

func appendU32(out []byte, values ...uint32) []byte {
	for _, value := range values {
		out = binary.LittleEndian.AppendUint32(out, value)
	}
	return out
}

func appendTypeIDs(out []byte, values ...uint32) []byte {
	for _, value := range values {
		out = append(out, compact(value)...)
	}
	return out
}

func compact(value uint32) []byte {
	switch {
	case value < 1<<6:
		return []byte{byte(value << 2)}
	case value < 1<<14:
		encoded := uint16(value<<2) | 0b01
		return []byte{byte(encoded), byte(encoded >> 8)}
	case value < 1<<30:
		encoded := value<<2 | 0b10
		return []byte{byte(encoded), byte(encoded >> 8), byte(encoded >> 16), byte(encoded >> 24)}
	default:
		return []byte{0b11, byte(value), byte(value >> 8), byte(value >> 16), byte(value >> 24)}
	}
}
