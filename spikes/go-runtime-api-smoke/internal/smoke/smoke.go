package smoke

import (
	"cartographer-go-smoke/internal/evidence"
	"cartographer-go-smoke/internal/rpccall"
)

// RuntimeCaller is the runtime API boundary used by the smoke coordinator.
type RuntimeCaller interface {
	CallRuntime(rpccall.Config) ([]rpccall.RuntimeCallEvidence, error)
}

// Run builds the Go smoke evidence envelope from env and a runtime caller.
func Run(env map[string]string, caller RuntimeCaller) (evidence.Envelope, error) {
	cfg, err := rpccall.ConfigFromEnv(env)
	if err != nil {
		return evidence.Envelope{}, err
	}

	callBytes, err := evidence.CallBytes(cfg.CallHex)
	if err != nil {
		return evidence.Envelope{}, err
	}

	calls, err := caller.CallRuntime(cfg)
	if err != nil {
		return evidence.Envelope{}, err
	}

	return evidence.Envelope{
		Label: "call",
		Input: evidence.Input{
			Account:          cfg.Account,
			CallBytes:        callBytes,
			ResultXCMVersion: cfg.ResultXCMVersion,
		},
		RuntimeCalls: runtimeCalls(calls),
	}, nil
}

func runtimeCalls(calls []rpccall.RuntimeCallEvidence) []evidence.RuntimeCallEvidence {
	out := make([]evidence.RuntimeCallEvidence, 0, len(calls))
	for _, call := range calls {
		out = append(out, evidence.RuntimeCallEvidence{
			Method: call.Method,
			Status: call.Status,
			RawHex: call.RawHex,
			Error:  call.Error,
		})
	}
	return out
}
