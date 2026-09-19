package device

import "testing"

func TestOverrideSimulatesAnotherComputerWithoutTouchingTheRealOne(t *testing.T) {
	real := Source{GOOS: "linux", ReadFile: files(map[string]string{"/etc/machine-id": linuxID}), Run: none}
	fake := real
	fake.Override = "laptop-2"
	a, _ := Fingerprint(real)
	b, err := Fingerprint(fake)
	if err != nil || b.Method != "override" || b.Hash == a.Hash {
		t.Fatalf("%+v vs %+v (%v)", b, a, err)
	}
	fake.Override = "  "
	if c, _ := Fingerprint(fake); c.Hash != a.Hash {
		t.Fatal("a blank override must be ignored")
	}
}
