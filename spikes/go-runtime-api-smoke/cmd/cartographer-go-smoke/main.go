package main

import (
	"fmt"
	"os"

	"cartographer-go-smoke/internal/evidence"
	"cartographer-go-smoke/internal/rpccall"
	"cartographer-go-smoke/internal/smoke"
)

func main() {
	env := map[string]string{
		"CARTOGRAPHER_IT_RPC":                os.Getenv("CARTOGRAPHER_IT_RPC"),
		"CARTOGRAPHER_IT_ACCOUNT":            os.Getenv("CARTOGRAPHER_IT_ACCOUNT"),
		"CARTOGRAPHER_IT_CALL":               os.Getenv("CARTOGRAPHER_IT_CALL"),
		"CARTOGRAPHER_IT_RESULT_XCM_VERSION": os.Getenv("CARTOGRAPHER_IT_RESULT_XCM_VERSION"),
	}

	envelope, err := smoke.Run(env, rpccall.BlockedRuntimeCaller{})
	if err != nil {
		fmt.Fprintf(os.Stderr, "cartographer-go-smoke: %v\n", err)
		os.Exit(1)
	}

	out, err := evidence.RenderJSON(envelope)
	if err != nil {
		fmt.Fprintf(os.Stderr, "cartographer-go-smoke: render evidence: %v\n", err)
		os.Exit(1)
	}

	fmt.Println(out)
}
