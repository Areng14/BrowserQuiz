package main

// Harness helper for Go: writes return values as JSON lines tagged with the run's marker, and runs each test
// in a child process (this same program, given the test's number), so a crash, an os.Exit or a hang is only
// that test's. The expected values never enter the sandbox, so a line can only say what the code returned.
// Everything here starts with bq, in the student's package.

import (
	"bytes"
	"fmt"
	"math"
	"os"
	"os/exec"
	"reflect"
	"runtime/debug"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const bqDoneCode = 97

var bqMarker string
var bqStdout = os.NewFile(1, "stdout")

func bqStr(b []byte, s string) []byte {
	b = append(b, '"')
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"' || c == '\\':
			b = append(b, '\\', c)
		case c == '\n':
			b = append(b, '\\', 'n')
		case c == '\t':
			b = append(b, '\\', 't')
		case c < 0x20:
			b = append(b, fmt.Sprintf("\\u%04x", c)...)
		default:
			b = append(b, c)
		}
	}
	return append(b, '"')
}

// A value as JSON. A nil slice or map is an empty one (what "no results" usually is in Go); a byte is a char.
func bqEnc(b []byte, v reflect.Value, d int) []byte {
	if d > 400 {
		return append(b, `"..."`...)
	}
	switch v.Kind() {
	case reflect.Invalid:
		return append(b, "null"...)
	case reflect.Bool:
		return strconv.AppendBool(b, v.Bool())
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return strconv.AppendInt(b, v.Int(), 10)
	case reflect.Uint8:
		return bqStr(b, string([]byte{byte(v.Uint())}))
	case reflect.Uint, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return strconv.AppendUint(b, v.Uint(), 10)
	case reflect.Float32, reflect.Float64:
		f := v.Float()
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return bqStr(b, strconv.FormatFloat(f, 'g', -1, 64))
		}
		return strconv.AppendFloat(b, f, 'g', -1, 64)
	case reflect.String:
		return bqStr(b, v.String())
	case reflect.Slice, reflect.Array:
		b = append(b, '[')
		for i := 0; i < v.Len(); i++ {
			if i > 0 {
				b = append(b, ',')
			}
			b = bqEnc(b, v.Index(i), d+1)
		}
		return append(b, ']')
	case reflect.Map:
		b = append(b, '{')
		for i, k := range v.MapKeys() {
			if i > 0 {
				b = append(b, ',')
			}
			if k.Kind() == reflect.String {
				b = bqStr(b, k.String())
			} else {
				b = bqStr(b, strconv.FormatInt(k.Int(), 10))
			}
			b = append(b, ':')
			b = bqEnc(b, v.MapIndex(k), d+1)
		}
		return append(b, '}')
	case reflect.Ptr, reflect.Interface:
		if v.IsNil() {
			return append(b, "null"...)
		}
		return bqEnc(b, v.Elem(), d+1)
	case reflect.Struct:
		b = append(b, '{')
		t := v.Type()
		for i := 0; i < v.NumField(); i++ {
			if i > 0 {
				b = append(b, ',')
			}
			b = bqStr(b, t.Field(i).Name)
			b = append(b, ':')
			b = bqEnc(b, v.Field(i), d+1)
		}
		return append(b, '}')
	}
	return bqStr(b, v.Type().String())
}

func bqOut(rec []byte) {
	line := append([]byte(bqMarker), rec...)
	bqStdout.Write(append(line, '\n'))
}

func bqOk(i int, v any) {
	b := []byte(`{"i":` + strconv.Itoa(i) + `,"ok":true,"v":`)
	bqOut(append(bqEnc(b, reflect.ValueOf(v), 0), '}'))
}

func bqStep(i, s int, v any) {
	b := []byte(`{"i":` + strconv.Itoa(i) + `,"s":` + strconv.Itoa(s) + `,"v":`)
	bqOut(append(bqEnc(b, reflect.ValueOf(v), 0), '}'))
}

func bqDone(i int) { bqOut([]byte(`{"i":` + strconv.Itoa(i) + `,"ok":true}`)) }

func bqFail(i int, msg string) {
	if len(msg) > 500 {
		msg = msg[:500]
	}
	b := []byte(`{"i":` + strconv.Itoa(i) + `,"ok":false,"err":`)
	bqOut(append(bqStr(b, msg), '}'))
}

// Big test arguments, made here instead of written out.
func bqLen(a, b, s int64) int64 {
	if s > 0 {
		if b > a {
			return (b - a + s - 1) / s
		}
		return 0
	}
	if a > b {
		return (a - b - s - 1) / -s
	}
	return 0
}
func bqRange(a, b, s int64) []int {
	x := make([]int, bqLen(a, b, s))
	for k := range x {
		x[k] = int(a + int64(k)*s)
	}
	return x
}
func bqRangeL(a, b, s int64) []int64 {
	x := make([]int64, bqLen(a, b, s))
	for k := range x {
		x[k] = a + int64(k)*s
	}
	return x
}

// In the child: run one test, turning a panic into its failure, with the line in their file.
func bqRunOne(i int, tests []func(int)) {
	debug.SetMaxStack(128 << 20) // runaway recursion is a stack overflow, not all the memory
	defer func() {
		if r := recover(); r != nil {
			msg := fmt.Sprint(r)
			if e, ok := r.(error); ok {
				msg = e.Error()
			}
			for _, line := range strings.Split(string(debug.Stack()), "\n") {
				if k := strings.Index(line, "solution.go:"); k >= 0 {
					msg += " (" + strings.Fields(line[k:])[0] + ")"
					break
				}
			}
			bqFail(i, "panic: "+msg)
		}
		os.Exit(bqDoneCode)
	}()
	tests[i](i)
}

// In the parent: each test in a child process, with a time limit.
func bqMain(marker string, tests []func(int), secs int) {
	bqMarker = marker
	if len(os.Args) > 1 {
		i, _ := strconv.Atoi(os.Args[1])
		bqRunOne(i, tests)
		return
	}
	os.Remove("bqmain.go")
	for i := range tests {
		var stderr bytes.Buffer
		cmd := exec.Command(os.Args[0], strconv.Itoa(i))
		cmd.Stdout = os.Stdout
		cmd.Stderr = &stderr
		if err := cmd.Start(); err != nil {
			bqFail(i, "Couldn't start the test")
			continue
		}
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		timedOut := false
		select {
		case <-done:
		case <-time.After(time.Duration(secs) * time.Second):
			timedOut = true
			cmd.Process.Kill()
			<-done
		}
		os.Stderr.Write(stderr.Bytes())
		st, _ := cmd.ProcessState.Sys().(syscall.WaitStatus)
		errText := stderr.String()
		switch {
		case timedOut || (st.Signaled() && (st.Signal() == syscall.SIGKILL || st.Signal() == syscall.SIGXCPU)):
			bqFail(i, "Ran out of time")
		case st.Exited() && st.ExitStatus() == bqDoneCode:
		case strings.Contains(errText, "stack overflow") || strings.Contains(errText, "stack exceeds"):
			bqFail(i, "Stack overflow: recursion too deep")
		case strings.Contains(errText, "out of memory"):
			bqFail(i, "Ran out of memory")
		case strings.Contains(errText, "all goroutines are asleep"):
			bqFail(i, "Deadlock: all goroutines are asleep")
		case st.Signaled():
			bqFail(i, "Crashed ("+st.Signal().String()+")")
		default:
			bqFail(i, "Stopped: the code called os.Exit("+strconv.Itoa(st.ExitStatus())+")")
		}
	}
}
