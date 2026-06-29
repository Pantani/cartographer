package metadatadecode

import (
	"encoding/binary"
	"errors"
	"fmt"
)

const metadataMagic uint32 = 0x6174656d

var (
	// ErrUnsupportedMetadataVersion reports metadata versions outside this V15/V16 spike.
	ErrUnsupportedMetadataVersion = errors.New("unsupported metadata version")
	errShortRead                  = errors.New("short SCALE metadata")
)

// MetadataProjection is the pure runtime API projection needed by the Go spike.
type MetadataProjection struct {
	Version     uint8
	RuntimeAPIs []RuntimeAPI
}

// RuntimeAPI describes one runtime API trait and its projected methods.
type RuntimeAPI struct {
	Name    string
	Methods []RuntimeAPIMethod
	Version *uint32
}

// RuntimeAPIMethod describes one runtime API method's name, params, and output type id.
type RuntimeAPIMethod struct {
	Name         string
	Params       []RuntimeAPIParam
	OutputTypeID uint32
}

// RuntimeAPIParam describes one runtime API method parameter.
type RuntimeAPIParam struct {
	Name   string
	TypeID uint32
}

// Reader is a small SCALE reader for metadata projection tests and helpers.
type Reader struct {
	data []byte
	pos  int
}

// NewReader returns a byte reader that fails on truncated SCALE fields.
func NewReader(data []byte) *Reader {
	return &Reader{data: data}
}

// DecodeRuntimeAPIs projects runtime API method metadata from V15/V16 SCALE metadata.
func DecodeRuntimeAPIs(data []byte) (MetadataProjection, error) {
	reader := NewReader(data)
	version, err := reader.readEnvelope()
	if err != nil {
		return MetadataProjection{}, err
	}

	switch version {
	case 15:
		apis, err := decodeV15RuntimeAPIs(reader)
		return MetadataProjection{Version: version, RuntimeAPIs: apis}, err
	case 16:
		apis, err := decodeV16RuntimeAPIs(reader)
		return MetadataProjection{Version: version, RuntimeAPIs: apis}, err
	default:
		return MetadataProjection{}, fmt.Errorf("%w: %d", ErrUnsupportedMetadataVersion, version)
	}
}

// FindRuntimeAPIMethod locates an API method by trait name and method name.
func FindRuntimeAPIMethod(metadata MetadataProjection, apiName, methodName string) (RuntimeAPIMethod, bool) {
	for _, api := range metadata.RuntimeAPIs {
		if api.Name != apiName {
			continue
		}
		for _, method := range api.Methods {
			if method.Name == methodName {
				return method, true
			}
		}
	}
	return RuntimeAPIMethod{}, false
}

// ReadCompactU32 decodes SCALE Compact<u32>, rejecting values wider than u32.
func (r *Reader) ReadCompactU32() (uint32, error) {
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

func decodeV15RuntimeAPIs(r *Reader) ([]RuntimeAPI, error) {
	if err := skipPortableRegistry(r); err != nil {
		return nil, err
	}
	if err := skipVec(r, skipV15Pallet); err != nil {
		return nil, err
	}
	if err := skipV15Extrinsic(r); err != nil {
		return nil, err
	}
	if _, err := r.readTypeID(); err != nil {
		return nil, err
	}
	return readRuntimeAPIs(r, false)
}

func decodeV16RuntimeAPIs(r *Reader) ([]RuntimeAPI, error) {
	if err := skipPortableRegistry(r); err != nil {
		return nil, err
	}
	if err := skipVec(r, skipV16Pallet); err != nil {
		return nil, err
	}
	if err := skipV16Extrinsic(r); err != nil {
		return nil, err
	}
	return readRuntimeAPIs(r, true)
}

func readRuntimeAPIs(r *Reader, v16 bool) ([]RuntimeAPI, error) {
	count, err := r.ReadCompactU32()
	if err != nil {
		return nil, err
	}

	apis := make([]RuntimeAPI, 0, count)
	for range count {
		api, err := readRuntimeAPI(r, v16)
		if err != nil {
			return nil, err
		}
		apis = append(apis, api)
	}
	return apis, nil
}

func readRuntimeAPI(r *Reader, v16 bool) (RuntimeAPI, error) {
	name, err := r.readString()
	if err != nil {
		return RuntimeAPI{}, err
	}
	methods, err := readRuntimeAPIMethods(r, v16)
	if err != nil {
		return RuntimeAPI{}, err
	}
	if err := r.skipStrings(); err != nil {
		return RuntimeAPI{}, err
	}

	api := RuntimeAPI{Name: name, Methods: methods}
	if v16 {
		version, err := r.ReadCompactU32()
		if err != nil {
			return RuntimeAPI{}, err
		}
		api.Version = &version
		if err := skipItemDeprecationInfo(r); err != nil {
			return RuntimeAPI{}, err
		}
	}
	return api, nil
}

func readRuntimeAPIMethods(r *Reader, v16 bool) ([]RuntimeAPIMethod, error) {
	count, err := r.ReadCompactU32()
	if err != nil {
		return nil, err
	}

	methods := make([]RuntimeAPIMethod, 0, count)
	for range count {
		method, err := readRuntimeAPIMethod(r, v16)
		if err != nil {
			return nil, err
		}
		methods = append(methods, method)
	}
	return methods, nil
}

func readRuntimeAPIMethod(r *Reader, v16 bool) (RuntimeAPIMethod, error) {
	name, err := r.readString()
	if err != nil {
		return RuntimeAPIMethod{}, err
	}
	params, err := readRuntimeAPIParams(r)
	if err != nil {
		return RuntimeAPIMethod{}, err
	}
	output, err := r.readTypeID()
	if err != nil {
		return RuntimeAPIMethod{}, err
	}
	if err := r.skipStrings(); err != nil {
		return RuntimeAPIMethod{}, err
	}
	if v16 {
		if err := skipItemDeprecationInfo(r); err != nil {
			return RuntimeAPIMethod{}, err
		}
	}
	return RuntimeAPIMethod{Name: name, Params: params, OutputTypeID: output}, nil
}

func readRuntimeAPIParams(r *Reader) ([]RuntimeAPIParam, error) {
	count, err := r.ReadCompactU32()
	if err != nil {
		return nil, err
	}

	params := make([]RuntimeAPIParam, 0, count)
	for range count {
		name, err := r.readString()
		if err != nil {
			return nil, err
		}
		ty, err := r.readTypeID()
		if err != nil {
			return nil, err
		}
		params = append(params, RuntimeAPIParam{Name: name, TypeID: ty})
	}
	return params, nil
}

func skipPortableRegistry(r *Reader) error {
	return skipVec(r, skipPortableType)
}

func skipPortableType(r *Reader) error {
	if _, err := r.ReadCompactU32(); err != nil {
		return err
	}
	return skipType(r)
}

func skipType(r *Reader) error {
	if err := skipPath(r); err != nil {
		return err
	}
	if err := skipVec(r, skipTypeParam); err != nil {
		return err
	}
	if err := skipTypeDef(r); err != nil {
		return err
	}
	return r.skipStrings()
}

func skipTypeDef(r *Reader) error {
	variant, err := r.readByte()
	if err != nil {
		return err
	}

	switch variant {
	case 0:
		return skipVec(r, skipField)
	case 1:
		return skipVec(r, skipVariant)
	case 2, 6:
		_, err := r.readTypeID()
		return err
	case 3:
		return skipArrayTypeDef(r)
	case 4:
		return skipVec(r, func(r *Reader) error {
			_, err := r.readTypeID()
			return err
		})
	case 5:
		_, err := r.readByte()
		return err
	case 7:
		return skipBitSequenceTypeDef(r)
	default:
		return fmt.Errorf("unsupported scale-info TypeDef variant %d", variant)
	}
}

func skipArrayTypeDef(r *Reader) error {
	if _, err := r.readU32(); err != nil {
		return err
	}
	_, err := r.readTypeID()
	return err
}

func skipBitSequenceTypeDef(r *Reader) error {
	if _, err := r.readTypeID(); err != nil {
		return err
	}
	_, err := r.readTypeID()
	return err
}

func skipPath(r *Reader) error {
	return r.skipStrings()
}

func skipTypeParam(r *Reader) error {
	if _, err := r.readString(); err != nil {
		return err
	}
	return r.skipOption(func(r *Reader) error {
		_, err := r.readTypeID()
		return err
	})
}

func skipField(r *Reader) error {
	if err := r.skipOption(func(r *Reader) error { _, err := r.readString(); return err }); err != nil {
		return err
	}
	if _, err := r.readTypeID(); err != nil {
		return err
	}
	if err := r.skipOption(func(r *Reader) error { _, err := r.readString(); return err }); err != nil {
		return err
	}
	return r.skipStrings()
}

func skipVariant(r *Reader) error {
	if _, err := r.readString(); err != nil {
		return err
	}
	if err := skipVec(r, skipField); err != nil {
		return err
	}
	if _, err := r.readByte(); err != nil {
		return err
	}
	return r.skipStrings()
}

func skipV15Extrinsic(r *Reader) error {
	if _, err := r.readByte(); err != nil {
		return err
	}
	if err := skipTypeIDs(r, 4); err != nil {
		return err
	}
	return skipVec(r, skipSignedExtension)
}

func skipV16Extrinsic(r *Reader) error {
	if err := r.skipBytesVec(); err != nil {
		return err
	}
	if err := skipTypeIDs(r, 3); err != nil {
		return err
	}
	if err := skipU8ToCompactU32VecMap(r); err != nil {
		return err
	}
	return skipVec(r, skipTransactionExtension)
}

func skipSignedExtension(r *Reader) error {
	if _, err := r.readString(); err != nil {
		return err
	}
	return skipTypeIDs(r, 2)
}

func skipTransactionExtension(r *Reader) error {
	return skipSignedExtension(r)
}

func skipV15Pallet(r *Reader) error {
	if _, err := r.readString(); err != nil {
		return err
	}
	if err := skipPalletBasics(r, false); err != nil {
		return err
	}
	if _, err := r.readByte(); err != nil {
		return err
	}
	return r.skipStrings()
}

func skipV16Pallet(r *Reader) error {
	if _, err := r.readString(); err != nil {
		return err
	}
	if err := skipPalletBasics(r, true); err != nil {
		return err
	}
	if err := skipVec(r, skipAssociatedType); err != nil {
		return err
	}
	if err := skipVec(r, skipViewFunction); err != nil {
		return err
	}
	if _, err := r.readByte(); err != nil {
		return err
	}
	if err := r.skipStrings(); err != nil {
		return err
	}
	return skipItemDeprecationInfo(r)
}

func skipPalletBasics(r *Reader, v16 bool) error {
	if err := r.skipOption(func(r *Reader) error { return skipPalletStorage(r, v16) }); err != nil {
		return err
	}
	if err := r.skipOption(func(r *Reader) error { return skipTypeMetadata(r, v16) }); err != nil {
		return err
	}
	if err := r.skipOption(func(r *Reader) error { return skipTypeMetadata(r, v16) }); err != nil {
		return err
	}
	if err := skipVec(r, func(r *Reader) error { return skipPalletConstant(r, v16) }); err != nil {
		return err
	}
	return r.skipOption(func(r *Reader) error { return skipTypeMetadata(r, v16) })
}

func skipPalletStorage(r *Reader, v16 bool) error {
	if _, err := r.readString(); err != nil {
		return err
	}
	return skipVec(r, func(r *Reader) error { return skipStorageEntry(r, v16) })
}

func skipStorageEntry(r *Reader, v16 bool) error {
	if _, err := r.readString(); err != nil {
		return err
	}
	if _, err := r.readByte(); err != nil {
		return err
	}
	if err := skipStorageEntryType(r); err != nil {
		return err
	}
	if err := r.skipBytesVec(); err != nil {
		return err
	}
	if err := r.skipStrings(); err != nil {
		return err
	}
	if v16 {
		return skipItemDeprecationInfo(r)
	}
	return nil
}

func skipStorageEntryType(r *Reader) error {
	variant, err := r.readByte()
	if err != nil {
		return err
	}
	switch variant {
	case 0:
		_, err := r.readTypeID()
		return err
	case 1:
		if err := r.skipBytesVec(); err != nil {
			return err
		}
		return skipTypeIDs(r, 2)
	default:
		return fmt.Errorf("unsupported storage entry type variant %d", variant)
	}
}

func skipPalletConstant(r *Reader, v16 bool) error {
	if _, err := r.readString(); err != nil {
		return err
	}
	if _, err := r.readTypeID(); err != nil {
		return err
	}
	if err := r.skipBytesVec(); err != nil {
		return err
	}
	if err := r.skipStrings(); err != nil {
		return err
	}
	if v16 {
		return skipItemDeprecationInfo(r)
	}
	return nil
}

func skipTypeMetadata(r *Reader, v16 bool) error {
	if _, err := r.readTypeID(); err != nil {
		return err
	}
	if v16 {
		return skipEnumDeprecationInfo(r)
	}
	return nil
}

func skipAssociatedType(r *Reader) error {
	if _, err := r.readString(); err != nil {
		return err
	}
	if _, err := r.readTypeID(); err != nil {
		return err
	}
	return r.skipStrings()
}

func skipViewFunction(r *Reader) error {
	if _, err := r.readBytes(32); err != nil {
		return err
	}
	if _, err := r.readString(); err != nil {
		return err
	}
	if _, err := readRuntimeAPIParams(r); err != nil {
		return err
	}
	if _, err := r.readTypeID(); err != nil {
		return err
	}
	if err := r.skipStrings(); err != nil {
		return err
	}
	return skipItemDeprecationInfo(r)
}

func skipItemDeprecationInfo(r *Reader) error {
	variant, err := r.readByte()
	if err != nil {
		return err
	}
	switch variant {
	case 0, 1:
		return nil
	case 2:
		return skipDeprecationNote(r)
	default:
		return fmt.Errorf("unsupported item deprecation variant %d", variant)
	}
}

func skipEnumDeprecationInfo(r *Reader) error {
	return skipVec(r, func(r *Reader) error {
		if _, err := r.readByte(); err != nil {
			return err
		}
		return skipVariantDeprecationInfo(r)
	})
}

func skipVariantDeprecationInfo(r *Reader) error {
	variant, err := r.readByte()
	if err != nil {
		return err
	}
	switch variant {
	case 1:
		return nil
	case 2:
		return skipDeprecationNote(r)
	default:
		return fmt.Errorf("unsupported variant deprecation variant %d", variant)
	}
}

func skipDeprecationNote(r *Reader) error {
	if _, err := r.readString(); err != nil {
		return err
	}
	return r.skipOption(func(r *Reader) error { _, err := r.readString(); return err })
}

func skipU8ToCompactU32VecMap(r *Reader) error {
	return skipVec(r, func(r *Reader) error {
		if _, err := r.readByte(); err != nil {
			return err
		}
		return skipVec(r, func(r *Reader) error {
			_, err := r.ReadCompactU32()
			return err
		})
	})
}

func skipTypeIDs(r *Reader, count int) error {
	for range count {
		if _, err := r.readTypeID(); err != nil {
			return err
		}
	}
	return nil
}

func skipVec(r *Reader, skip func(*Reader) error) error {
	count, err := r.ReadCompactU32()
	if err != nil {
		return err
	}
	for range count {
		if err := skip(r); err != nil {
			return err
		}
	}
	return nil
}

func (r *Reader) readEnvelope() (uint8, error) {
	magic, err := r.readU32()
	if err != nil {
		return 0, err
	}
	if magic != metadataMagic {
		return 0, fmt.Errorf("invalid metadata magic 0x%08x", magic)
	}
	return r.readByte()
}

func (r *Reader) readBigCompactU32(first byte) (uint32, error) {
	byteCount := int(first>>2) + 4
	if byteCount > 4 {
		return 0, fmt.Errorf("compact integer exceeds u32: %d bytes", byteCount)
	}
	bytes, err := r.readBytes(byteCount)
	if err != nil {
		return 0, err
	}

	var value uint32
	for i, b := range bytes {
		value |= uint32(b) << (8 * i)
	}
	return value, nil
}

func (r *Reader) readTypeID() (uint32, error) {
	return r.ReadCompactU32()
}

func (r *Reader) readString() (string, error) {
	bytes, err := r.readBytesVec()
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

func (r *Reader) skipStrings() error {
	return skipVec(r, func(r *Reader) error {
		_, err := r.readString()
		return err
	})
}

func (r *Reader) skipBytesVec() error {
	_, err := r.readBytesVec()
	return err
}

func (r *Reader) readBytesVec() ([]byte, error) {
	length, err := r.ReadCompactU32()
	if err != nil {
		return nil, err
	}
	return r.readBytes(int(length))
}

func (r *Reader) skipOption(skipSome func(*Reader) error) error {
	flag, err := r.readByte()
	if err != nil {
		return err
	}
	switch flag {
	case 0:
		return nil
	case 1:
		return skipSome(r)
	default:
		return fmt.Errorf("invalid Option discriminant %d", flag)
	}
}

func (r *Reader) readByte() (uint8, error) {
	bytes, err := r.readBytes(1)
	if err != nil {
		return 0, err
	}
	return bytes[0], nil
}

func (r *Reader) readU32() (uint32, error) {
	bytes, err := r.readBytes(4)
	if err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint32(bytes), nil
}

func (r *Reader) readBytes(length int) ([]byte, error) {
	if length < 0 || r.pos+length > len(r.data) {
		return nil, errShortRead
	}
	bytes := r.data[r.pos : r.pos+length]
	r.pos += length
	return bytes, nil
}
