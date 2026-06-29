package metadata

import (
	"fmt"
	"strings"
)

// TypeID identifies a type in the runtime metadata portable registry.
type TypeID uint64

// RuntimeAPI is the projected runtime API metadata shape used by this spike.
type RuntimeAPI struct {
	Name    string
	Methods []RuntimeAPIMethod
}

// RuntimeAPIMethod is the projected runtime API method metadata shape used by this spike.
type RuntimeAPIMethod struct {
	Name         string
	Inputs       []RuntimeAPIParam
	OutputTypeID TypeID
}

// RuntimeAPIParam is the projected runtime API method parameter metadata shape used by this spike.
type RuntimeAPIParam struct {
	Name   string
	TypeID TypeID
}

// RuntimeAPIMethodName is a parsed state_call runtime API method name.
type RuntimeAPIMethodName struct {
	API           string
	Method        string
	StateCallName string
}

// RuntimeAPIMethodLocation represents a runtime API method located in projected metadata.
type RuntimeAPIMethodLocation struct {
	RuntimeAPIMethodName
	Inputs       []RuntimeAPIParam
	OutputTypeID TypeID
}

// ParseStateCallName splits a Substrate state_call runtime API name into API and method parts.
func ParseStateCallName(name string) (RuntimeAPIMethodName, error) {
	trimmed := strings.TrimSpace(name)
	api, method, ok := strings.Cut(trimmed, "_")
	if !ok || api == "" || method == "" {
		return RuntimeAPIMethodName{}, fmt.Errorf("runtime API state_call name must be API_method")
	}
	if strings.TrimSpace(api) != api || strings.TrimSpace(method) != method {
		return RuntimeAPIMethodName{}, fmt.Errorf("runtime API state_call name must not contain surrounding whitespace in parts")
	}

	return RuntimeAPIMethodName{
		API:           api,
		Method:        method,
		StateCallName: trimmed,
	}, nil
}

// LocateRuntimeAPIMethod finds a method by state_call name in projected runtime API metadata.
func LocateRuntimeAPIMethod(apis []RuntimeAPI, stateCallName string) (RuntimeAPIMethodLocation, bool, error) {
	parsed, err := ParseStateCallName(stateCallName)
	if err != nil {
		return RuntimeAPIMethodLocation{}, false, err
	}

	for _, api := range apis {
		if api.Name != parsed.API {
			continue
		}
		for _, method := range api.Methods {
			if method.Name != parsed.Method {
				continue
			}
			return RuntimeAPIMethodLocation{
				RuntimeAPIMethodName: parsed,
				Inputs:               append([]RuntimeAPIParam(nil), method.Inputs...),
				OutputTypeID:         method.OutputTypeID,
			}, true, nil
		}
	}

	return RuntimeAPIMethodLocation{}, false, nil
}
