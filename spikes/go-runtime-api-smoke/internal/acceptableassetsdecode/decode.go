package acceptableassetsdecode

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"strconv"
)

const (
	// StatusOK identifies a decoded Ok(Vec<VersionedAssetId>) return.
	StatusOK = "ok"
	// StatusError identifies a decoded Err(XcmPaymentApi::Error) return.
	StatusError = "error"
)

var (
	// ErrMalformedReturn marks SCALE bytes that do not match the sourced return envelope.
	ErrMalformedReturn = errors.New("malformed acceptable payment assets return")
	errUnknownPayload  = errors.New("unimplemented VersionedAssetId payload shape")
)

// ReturnValue is the decoded authored return value for XcmPaymentApi_query_acceptable_payment_assets.
type ReturnValue struct {
	Status     string             `json:"status"`
	AssetCount uint32             `json:"assetCount,omitempty"`
	Assets     []VersionedAssetID `json:"assets,omitempty"`
	Error      *PaymentError      `json:"error,omitempty"`
}

// VersionedAssetID records the sourced version wrapper and raw payload bytes.
type VersionedAssetID struct {
	Version    uint8                 `json:"version"`
	VersionTag string                `json:"versionTag"`
	PayloadHex string                `json:"payloadHex"`
	Decoded    *AssetPayloadEvidence `json:"decoded,omitempty"`
}

// AssetPayloadEvidence records only source-backed simple payload cases.
type AssetPayloadEvidence struct {
	Kind        string             `json:"kind"`
	Parents     uint8              `json:"parents,omitempty"`
	Interior    string             `json:"interior,omitempty"`
	Junctions   []JunctionEvidence `json:"junctions,omitempty"`
	AbstractHex string             `json:"abstractHex,omitempty"`
}

// JunctionEvidence records source-backed XCM junction fields needed to bound asset payloads.
type JunctionEvidence struct {
	Kind     string `json:"kind"`
	Value    string `json:"value,omitempty"`
	Network  string `json:"network,omitempty"`
	IDHex    string `json:"idHex,omitempty"`
	KeyHex   string `json:"keyHex,omitempty"`
	Length   uint8  `json:"length,omitempty"`
	BodyID   string `json:"bodyId,omitempty"`
	BodyPart string `json:"bodyPart,omitempty"`
}

// PaymentError is the typed XcmPaymentApi error enum returned by the runtime API.
type PaymentError struct {
	Index uint8  `json:"index"`
	Name  string `json:"name"`
}

// DecodeReturn decodes the authored SCALE return Result<Vec<VersionedAssetId>, Error> without network I/O.
func DecodeReturn(data []byte) (ReturnValue, error) {
	reader := newReader(data)
	tag, err := reader.readByte()
	if err != nil {
		return ReturnValue{}, wrapMalformed("short SCALE return: %v", err)
	}

	switch tag {
	case 0:
		return decodeOK(reader)
	case 1:
		return decodeError(reader)
	default:
		return ReturnValue{}, wrapMalformed("unknown Result tag %d", tag)
	}
}

func decodeOK(reader *scaleReader) (ReturnValue, error) {
	count, err := reader.readCompactU32()
	if err != nil {
		return ReturnValue{}, wrapMalformed("short Ok asset vector length: %v", err)
	}

	assets := make([]VersionedAssetID, 0, count)
	for i := uint32(0); i < count; i++ {
		asset, err := decodeVersionedAssetID(reader, i == count-1)
		if err != nil {
			return ReturnValue{}, err
		}
		assets = append(assets, asset)
	}

	if reader.remaining() != 0 {
		return ReturnValue{}, wrapMalformed("trailing data after Ok asset vector: %d byte(s)", reader.remaining())
	}

	return ReturnValue{
		Status:     StatusOK,
		AssetCount: count,
		Assets:     assets,
	}, nil
}

func decodeError(reader *scaleReader) (ReturnValue, error) {
	index, err := reader.readByte()
	if err != nil {
		return ReturnValue{}, wrapMalformed("short XcmPaymentApi Error enum: %v", err)
	}

	name, ok := paymentErrorName(index)
	if !ok {
		return ReturnValue{}, wrapMalformed("unknown XcmPaymentApi Error index %d", index)
	}
	if reader.remaining() != 0 {
		return ReturnValue{}, wrapMalformed("trailing data after XcmPaymentApi Error: %d byte(s)", reader.remaining())
	}

	return ReturnValue{
		Status: StatusError,
		Error:  &PaymentError{Index: index, Name: name},
	}, nil
}

func decodeVersionedAssetID(reader *scaleReader, finalEntry bool) (VersionedAssetID, error) {
	version, err := reader.readByte()
	if err != nil {
		return VersionedAssetID{}, wrapMalformed("short VersionedAssetId enum: %v", err)
	}
	if version != 3 && version != 4 && version != 5 {
		return VersionedAssetID{}, wrapMalformed("unknown VersionedAssetId index %d", version)
	}

	start := reader.pos
	decoded, err := decodeVersionedPayload(reader, version)
	if err == nil {
		return versionedAsset(version, reader.bytesFrom(start), decoded), nil
	}
	if !errors.Is(err, errUnknownPayload) {
		return VersionedAssetID{}, err
	}
	reader.pos = start
	if !finalEntry {
		return VersionedAssetID{}, wrapMalformed("cannot bound non-final VersionedAssetId payload for V%d", version)
	}
	if reader.remaining() == 0 {
		return VersionedAssetID{}, wrapMalformed("short VersionedAssetId V%d payload", version)
	}

	payload := reader.readRemaining()
	return versionedAsset(version, payload, nil), nil
}

func decodeVersionedPayload(reader *scaleReader, version uint8) (*AssetPayloadEvidence, error) {
	if version == 3 {
		return decodeV3AssetID(reader)
	}
	return decodeLocation(reader, version, "Location")
}

func decodeV3AssetID(reader *scaleReader) (*AssetPayloadEvidence, error) {
	assetTag, err := reader.readByte()
	if err != nil {
		return nil, wrapMalformed("short V3 AssetId enum: %v", err)
	}

	switch assetTag {
	case 0:
		return decodeLocation(reader, 3, "ConcreteLocation")
	case 1:
		abstract, err := reader.readBytes(32)
		if err != nil {
			return nil, wrapMalformed("short V3 Abstract asset id: %v", err)
		}
		return &AssetPayloadEvidence{
			Kind:        "Abstract",
			AbstractHex: hexString(abstract),
		}, nil
	default:
		return nil, wrapMalformed("unknown V3 AssetId index %d", assetTag)
	}
}

func decodeLocation(reader *scaleReader, version uint8, kind string) (*AssetPayloadEvidence, error) {
	parents, err := reader.readByte()
	if err != nil {
		return nil, wrapMalformed("short XCM Location parents: %v", err)
	}
	interior, junctions, err := decodeJunctions(reader, version)
	if err != nil {
		return nil, err
	}
	if interior == "Here" {
		if kind == "ConcreteLocation" {
			kind = "ConcreteLocationHere"
		} else {
			kind = "LocationHere"
		}
	} else if kind == "Location" || kind == "ConcreteLocation" {
		kind = kind
	}

	return &AssetPayloadEvidence{
		Kind:      kind,
		Parents:   parents,
		Interior:  interior,
		Junctions: junctions,
	}, nil
}

func decodeJunctions(reader *scaleReader, version uint8) (string, []JunctionEvidence, error) {
	tag, err := reader.readByte()
	if err != nil {
		return "", nil, wrapMalformed("short XCM Location interior: %v", err)
	}
	if tag == 0 {
		return "Here", nil, nil
	}
	if tag > 8 {
		return "", nil, wrapMalformed("unknown Junctions index %d", tag)
	}

	junctions := make([]JunctionEvidence, 0, tag)
	for i := uint8(0); i < tag; i++ {
		junction, err := decodeJunction(reader, version)
		if err != nil {
			return "", nil, err
		}
		junctions = append(junctions, junction)
	}
	return fmt.Sprintf("X%d", tag), junctions, nil
}

func decodeJunction(reader *scaleReader, version uint8) (JunctionEvidence, error) {
	tag, err := reader.readByte()
	if err != nil {
		return JunctionEvidence{}, wrapMalformed("short Junction enum: %v", err)
	}

	switch tag {
	case 0:
		value, err := reader.readCompactU32()
		if err != nil {
			return JunctionEvidence{}, wrapMalformed("short Junction::Parachain id: %v", err)
		}
		return JunctionEvidence{Kind: "Parachain", Value: strconv.FormatUint(uint64(value), 10)}, nil
	case 1:
		network, err := decodeOptionNetworkID(reader, version)
		if err != nil {
			return JunctionEvidence{}, err
		}
		id, err := reader.readBytes(32)
		if err != nil {
			return JunctionEvidence{}, wrapMalformed("short Junction::AccountId32 id: %v", err)
		}
		return JunctionEvidence{Kind: "AccountId32", Network: network, IDHex: hexString(id)}, nil
	case 2:
		network, err := decodeOptionNetworkID(reader, version)
		if err != nil {
			return JunctionEvidence{}, err
		}
		index, err := reader.readCompactU64()
		if err != nil {
			return JunctionEvidence{}, wrapMalformed("short Junction::AccountIndex64 index: %v", err)
		}
		return JunctionEvidence{Kind: "AccountIndex64", Network: network, Value: strconv.FormatUint(index, 10)}, nil
	case 3:
		network, err := decodeOptionNetworkID(reader, version)
		if err != nil {
			return JunctionEvidence{}, err
		}
		key, err := reader.readBytes(20)
		if err != nil {
			return JunctionEvidence{}, wrapMalformed("short Junction::AccountKey20 key: %v", err)
		}
		return JunctionEvidence{Kind: "AccountKey20", Network: network, KeyHex: hexString(key)}, nil
	case 4:
		instance, err := reader.readByte()
		if err != nil {
			return JunctionEvidence{}, wrapMalformed("short Junction::PalletInstance: %v", err)
		}
		return JunctionEvidence{Kind: "PalletInstance", Value: strconv.FormatUint(uint64(instance), 10)}, nil
	case 5:
		index, err := reader.readCompactU128String()
		if err != nil {
			return JunctionEvidence{}, wrapMalformed("short Junction::GeneralIndex: %v", err)
		}
		return JunctionEvidence{Kind: "GeneralIndex", Value: index}, nil
	case 6:
		length, err := reader.readByte()
		if err != nil {
			return JunctionEvidence{}, wrapMalformed("short Junction::GeneralKey length: %v", err)
		}
		data, err := reader.readBytes(32)
		if err != nil {
			return JunctionEvidence{}, wrapMalformed("short Junction::GeneralKey data: %v", err)
		}
		return JunctionEvidence{Kind: "GeneralKey", Length: length, KeyHex: hexString(data)}, nil
	case 7:
		return JunctionEvidence{Kind: "OnlyChild"}, nil
	case 8:
		bodyID, err := decodeBodyID(reader)
		if err != nil {
			return JunctionEvidence{}, err
		}
		bodyPart, err := decodeBodyPart(reader)
		if err != nil {
			return JunctionEvidence{}, err
		}
		return JunctionEvidence{Kind: "Plurality", BodyID: bodyID, BodyPart: bodyPart}, nil
	case 9:
		network, err := decodeNetworkID(reader, version)
		if err != nil {
			return JunctionEvidence{}, err
		}
		return JunctionEvidence{Kind: "GlobalConsensus", Network: network}, nil
	default:
		return JunctionEvidence{}, wrapMalformed("unknown Junction index %d", tag)
	}
}

func decodeOptionNetworkID(reader *scaleReader, version uint8) (string, error) {
	tag, err := reader.readByte()
	if err != nil {
		return "", wrapMalformed("short Option<NetworkId>: %v", err)
	}
	switch tag {
	case 0:
		return "None", nil
	case 1:
		return decodeNetworkID(reader, version)
	default:
		return "", wrapMalformed("invalid Option<NetworkId> discriminant %d", tag)
	}
}

func decodeNetworkID(reader *scaleReader, version uint8) (string, error) {
	tag, err := reader.readByte()
	if err != nil {
		return "", wrapMalformed("short NetworkId enum: %v", err)
	}

	switch tag {
	case 0:
		hash, err := reader.readBytes(32)
		if err != nil {
			return "", wrapMalformed("short NetworkId::ByGenesis hash: %v", err)
		}
		return "ByGenesis(" + hexString(hash) + ")", nil
	case 1:
		if _, err := reader.readU64(); err != nil {
			return "", wrapMalformed("short NetworkId::ByFork block number: %v", err)
		}
		hash, err := reader.readBytes(32)
		if err != nil {
			return "", wrapMalformed("short NetworkId::ByFork hash: %v", err)
		}
		return "ByFork(" + hexString(hash) + ")", nil
	case 2:
		return "Polkadot", nil
	case 3:
		return "Kusama", nil
	case 4:
		if version == 5 {
			return "", wrapMalformed("unknown V5 NetworkId index %d", tag)
		}
		return "Westend", nil
	case 5:
		if version == 5 {
			return "", wrapMalformed("unknown V5 NetworkId index %d", tag)
		}
		return "Rococo", nil
	case 6:
		if version == 5 {
			return "", wrapMalformed("unknown V5 NetworkId index %d", tag)
		}
		return "Wococo", nil
	case 7:
		chainID, err := reader.readCompactU64()
		if err != nil {
			return "", wrapMalformed("short NetworkId::Ethereum chain id: %v", err)
		}
		return "Ethereum(" + strconv.FormatUint(chainID, 10) + ")", nil
	case 8:
		return "BitcoinCore", nil
	case 9:
		return "BitcoinCash", nil
	case 10:
		return "PolkadotBulletin", nil
	default:
		return "", wrapMalformed("unknown NetworkId index %d", tag)
	}
}

func decodeBodyID(reader *scaleReader) (string, error) {
	tag, err := reader.readByte()
	if err != nil {
		return "", wrapMalformed("short BodyId enum: %v", err)
	}
	switch tag {
	case 0:
		return "Unit", nil
	case 1:
		value, err := reader.readBytes(4)
		if err != nil {
			return "", wrapMalformed("short BodyId::Moniker: %v", err)
		}
		return "Moniker(" + hexString(value) + ")", nil
	case 2:
		value, err := reader.readCompactU32()
		if err != nil {
			return "", wrapMalformed("short BodyId::Index: %v", err)
		}
		return "Index(" + strconv.FormatUint(uint64(value), 10) + ")", nil
	case 3:
		return "Executive", nil
	case 4:
		return "Technical", nil
	case 5:
		return "Legislative", nil
	case 6:
		return "Judicial", nil
	case 7:
		return "Defense", nil
	case 8:
		return "Administration", nil
	case 9:
		return "Treasury", nil
	default:
		return "", wrapMalformed("unknown BodyId index %d", tag)
	}
}

func decodeBodyPart(reader *scaleReader) (string, error) {
	tag, err := reader.readByte()
	if err != nil {
		return "", wrapMalformed("short BodyPart enum: %v", err)
	}
	switch tag {
	case 0:
		return "Voice", nil
	case 1:
		value, err := reader.readCompactU32()
		if err != nil {
			return "", wrapMalformed("short BodyPart::Members: %v", err)
		}
		return "Members(" + strconv.FormatUint(uint64(value), 10) + ")", nil
	case 2, 3, 4:
		nom, err := reader.readCompactU32()
		if err != nil {
			return "", wrapMalformed("short BodyPart proportion numerator: %v", err)
		}
		denom, err := reader.readCompactU32()
		if err != nil {
			return "", wrapMalformed("short BodyPart proportion denominator: %v", err)
		}
		name := map[uint8]string{2: "Fraction", 3: "AtLeastProportion", 4: "MoreThanProportion"}[tag]
		return fmt.Sprintf("%s(%d/%d)", name, nom, denom), nil
	default:
		return "", wrapMalformed("unknown BodyPart index %d", tag)
	}
}

func versionedAsset(version uint8, payload []byte, decoded *AssetPayloadEvidence) VersionedAssetID {
	return VersionedAssetID{
		Version:    version,
		VersionTag: fmt.Sprintf("V%d", version),
		PayloadHex: hexString(payload),
		Decoded:    decoded,
	}
}

func paymentErrorName(index uint8) (string, bool) {
	switch index {
	case 0:
		return "Unimplemented", true
	case 1:
		return "VersionedConversionFailed", true
	case 2:
		return "WeightNotComputable", true
	case 3:
		return "UnhandledXcmVersion", true
	case 4:
		return "AssetNotFound", true
	case 5:
		return "Unroutable", true
	default:
		return "", false
	}
}

func hexString(data []byte) string {
	return "0x" + hex.EncodeToString(data)
}

func wrapMalformed(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrMalformedReturn, fmt.Sprintf(format, args...))
}

type scaleReader struct {
	data []byte
	pos  int
}

func newReader(data []byte) *scaleReader {
	return &scaleReader{data: data}
}

func (r *scaleReader) readByte() (uint8, error) {
	if r.remaining() < 1 {
		return 0, errors.New("short read")
	}
	value := r.data[r.pos]
	r.pos++
	return value, nil
}

func (r *scaleReader) readBytes(count int) ([]byte, error) {
	if r.remaining() < count {
		return nil, errors.New("short read")
	}
	start := r.pos
	r.pos += count
	return r.data[start:r.pos], nil
}

func (r *scaleReader) readCompactU32() (uint32, error) {
	first, err := r.readByte()
	if err != nil {
		return 0, err
	}

	switch first & 0b11 {
	case 0:
		return uint32(first >> 2), nil
	case 1:
		second, err := r.readByte()
		if err != nil {
			return 0, err
		}
		return uint32(binary.LittleEndian.Uint16([]byte{first, second}) >> 2), nil
	case 2:
		bytes, err := r.readBytes(3)
		if err != nil {
			return 0, err
		}
		encoded := uint32(first) | uint32(bytes[0])<<8 | uint32(bytes[1])<<16 | uint32(bytes[2])<<24
		return encoded >> 2, nil
	default:
		return r.readBigCompactU32(first)
	}
}

func (r *scaleReader) readCompactU64() (uint64, error) {
	first, err := r.readByte()
	if err != nil {
		return 0, err
	}

	switch first & 0b11 {
	case 0:
		return uint64(first >> 2), nil
	case 1:
		second, err := r.readByte()
		if err != nil {
			return 0, err
		}
		return uint64(binary.LittleEndian.Uint16([]byte{first, second}) >> 2), nil
	case 2:
		bytes, err := r.readBytes(3)
		if err != nil {
			return 0, err
		}
		encoded := uint32(first) | uint32(bytes[0])<<8 | uint32(bytes[1])<<16 | uint32(bytes[2])<<24
		return uint64(encoded >> 2), nil
	default:
		byteLen := int(first>>2) + 4
		if byteLen > 8 {
			return 0, fmt.Errorf("compact integer exceeds u64: %d byte(s)", byteLen)
		}
		bytes, err := r.readBytes(byteLen)
		if err != nil {
			return 0, err
		}
		var padded [8]byte
		copy(padded[:], bytes)
		return binary.LittleEndian.Uint64(padded[:]), nil
	}
}

func (r *scaleReader) readCompactU128String() (string, error) {
	first, err := r.readByte()
	if err != nil {
		return "", err
	}

	switch first & 0b11 {
	case 0:
		return strconv.FormatUint(uint64(first>>2), 10), nil
	case 1:
		second, err := r.readByte()
		if err != nil {
			return "", err
		}
		return strconv.FormatUint(uint64(binary.LittleEndian.Uint16([]byte{first, second})>>2), 10), nil
	case 2:
		bytes, err := r.readBytes(3)
		if err != nil {
			return "", err
		}
		encoded := uint32(first) | uint32(bytes[0])<<8 | uint32(bytes[1])<<16 | uint32(bytes[2])<<24
		return strconv.FormatUint(uint64(encoded>>2), 10), nil
	default:
		byteLen := int(first>>2) + 4
		if byteLen > 16 {
			return "", fmt.Errorf("compact integer exceeds u128: %d byte(s)", byteLen)
		}
		bytes, err := r.readBytes(byteLen)
		if err != nil {
			return "", err
		}
		reversed := make([]byte, len(bytes))
		for i, value := range bytes {
			reversed[len(bytes)-1-i] = value
		}
		return new(big.Int).SetBytes(reversed).String(), nil
	}
}

func (r *scaleReader) readBigCompactU32(first uint8) (uint32, error) {
	byteLen := int(first>>2) + 4
	if byteLen > 4 {
		return 0, fmt.Errorf("compact integer exceeds u32: %d byte(s)", byteLen)
	}
	bytes, err := r.readBytes(byteLen)
	if err != nil {
		return 0, err
	}

	var padded [4]byte
	copy(padded[:], bytes)
	return binary.LittleEndian.Uint32(padded[:]), nil
}

func (r *scaleReader) readU64() (uint64, error) {
	bytes, err := r.readBytes(8)
	if err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint64(bytes), nil
}

func (r *scaleReader) bytesFrom(start int) []byte {
	return r.data[start:r.pos]
}

func (r *scaleReader) readRemaining() []byte {
	start := r.pos
	r.pos = len(r.data)
	return r.data[start:]
}

func (r *scaleReader) remaining() int {
	return len(r.data) - r.pos
}
