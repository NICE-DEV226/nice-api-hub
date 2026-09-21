package fsnav

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func tree(t *testing.T, dirs ...string) string {
	t.Helper()
	root := t.TempDir()
	for _, d := range dirs {
		if err := os.MkdirAll(filepath.Join(root, d), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

func names(es []Entry) []string {
	out := make([]string, len(es))
	for i, e := range es {
		out[i] = e.Name
	}
	return out
}

func TestListShowsOnlyFoldersSortedIgnoringCase(t *testing.T) {
	root := tree(t, "zeta", "Alpha", "beta", ".git", "Videos/2026")
	os.WriteFile(filepath.Join(root, "notes.txt"), nil, 0o644)
	got, err := List(root, false)
	if err != nil || !reflect.DeepEqual(names(got), []string{"Alpha", "beta", "Videos", "zeta"}) {
		t.Fatalf("%v %v", names(got), err)
	}
	all, _ := List(root, true)
	if !reflect.DeepEqual(names(all), []string{".git", "Alpha", "beta", "Videos", "zeta"}) {
		t.Fatalf("hidden: %v", names(all))
	}
	if !all[0].Hidden || all[1].Hidden {
		t.Fatal("hidden flag")
	}
	if _, err := List(filepath.Join(root, "missing"), false); err == nil {
		t.Fatal("a missing folder is an error")
	}
}

func TestListFollowsSymlinksToFoldersButNotToFiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlinks need privileges on Windows")
	}
	root := tree(t, "real")
	os.WriteFile(filepath.Join(root, "f.txt"), nil, 0o644)
	os.Symlink(filepath.Join(root, "real"), filepath.Join(root, "link"))
	os.Symlink(filepath.Join(root, "f.txt"), filepath.Join(root, "filelink"))
	os.Symlink(filepath.Join(root, "gone"), filepath.Join(root, "dangling"))
	got, _ := List(root, false)
	if !reflect.DeepEqual(names(got), []string{"link", "real"}) {
		t.Fatalf("%v", names(got))
	}
}

func TestCrumbsShortenHomeAndKeepEverySegmentClickable(t *testing.T) {
	sep := string(filepath.Separator)
	home := sep + "home" + sep + "ada"
	got := Crumbs(filepath.Join(home, "Videos", "2026"), home)
	labels := []string{}
	for _, c := range got {
		labels = append(labels, c.Label)
	}
	if !reflect.DeepEqual(labels, []string{"~", "Videos", "2026"}) || got[0].Path != home || got[1].Path != filepath.Join(home, "Videos") {
		t.Fatalf("%+v", got)
	}
	if got := Crumbs(home, home); len(got) != 1 || got[0].Label != "~" {
		t.Fatalf("home itself: %+v", got)
	}
	if runtime.GOOS != "windows" {
		outside := Crumbs("/srv/media/x", home)
		if len(outside) != 4 || outside[0].Label != "/" || outside[0].Path != "/" || outside[3].Path != "/srv/media/x" {
			t.Fatalf("%+v", outside)
		}
		// a sibling whose name merely starts with the home path is NOT inside home
		if c := Crumbs("/home/ada2/x", home); c[0].Label != "/" {
			t.Fatalf("%+v", c)
		}
		if root := Crumbs("/", home); len(root) != 1 || root[0].Path != "/" {
			t.Fatalf("%+v", root)
		}
	}
}

// fakeEnv is an emulated system. Its folders are given with "/" and matched ignoring the platform's separator, so the tests
// give the same answer on Windows, where filepath.Join produces backslashes.
func fakeEnv(goos, home string, dirs map[string]bool, drives ...string) Env {
	norm := map[string]bool{}
	for d, ok := range dirs {
		norm[filepath.ToSlash(d)] = ok
	}
	return Env{GOOS: goos, Home: func() (string, error) { return home, nil },
		Getenv: func(k string) string {
			if k == "USER" {
				return "ada"
			}
			return ""
		},
		IsDir: func(p string) bool { return norm[filepath.ToSlash(p)] }, Drives: func() []string { return drives }}
}

func labels(ps []Place) []string {
	out := make([]string, len(ps))
	for i, p := range ps {
		out[i] = p.Label
	}
	return out
}

func TestPlacesOnlyListWhatExistsAndPutRecentFirst(t *testing.T) {
	sep := string(filepath.Separator)
	home := sep + "home" + sep + "ada"
	dirs := map[string]bool{home: true, filepath.Join(home, "Downloads"): true, filepath.Join(home, "Videos"): true,
		filepath.Join(home, "Music"): true, "/run/media/ada": true, "/": true, "/tmp/keep": true}
	got := labels(Places(fakeEnv("linux", home, dirs), filepath.Join(home, "Downloads"), []string{"/tmp/keep", "/gone", filepath.Join(home, "Videos")}))
	want := []string{"» keep", "» Videos", "Downloads", "Music", "Home", "Drives", "/"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("%v want %v", got, want)
	}
}

func TestPlacesPerOperatingSystem(t *testing.T) {
	home := "/Users/ada"
	mac := map[string]bool{home: true, home + "/Movies": true, home + "/Downloads": true, "/Volumes": true, "/": true}
	got := labels(Places(fakeEnv("darwin", home, mac), "", nil))
	if !reflect.DeepEqual(got, []string{"Downloads", "Movies", "Home", "Volumes", "/"}) {
		t.Fatalf("macOS: %v", got)
	}
	winHome := `C:\Users\ada`
	win := map[string]bool{winHome: true, winHome + `\Downloads`: true, `C:\`: true, `D:\`: true}
	if runtime.GOOS == "windows" {
		got = labels(Places(fakeEnv("windows", winHome, win, `C:\`, `D:\`), "", nil))
		if !reflect.DeepEqual(got, []string{"Downloads", "Home", "C:", "D:"}) {
			t.Fatalf("windows: %v", got)
		}
	}
}

func TestExpandAndLooksLikePath(t *testing.T) {
	if Expand("~", "/h") != "/h" || Expand("~/x", "/h") != filepath.Join("/h", "x") || Expand("~x", "/h") != "~x" || Expand("/a", "/h") != "/a" {
		t.Fatal("expand")
	}
	for _, s := range []string{"/srv", "~", "~/Videos", `C:\Users`, "d:/x", "./a", "../b", `\\server`} {
		if !LooksLikePath(s) {
			t.Errorf("%q should look like a path", s)
		}
	}
	for _, s := range []string{"", "vid", "my folder", "1:x", "-x"} {
		if LooksLikePath(s) {
			t.Errorf("%q is a filter word", s)
		}
	}
}

func TestCompleteFindsTheLongestCommonPrefix(t *testing.T) {
	root := tree(t, "Videos", "Vacation", "Music", ".hidden")
	sep := string(filepath.Separator)
	got, m := Complete(root+sep+"V", "", false)
	if got != filepath.Join(root, "V") || len(m) != 2 {
		t.Fatalf("%q %v", got, m)
	}
	got, m = Complete(root+sep+"Vi", "", false)
	if got != filepath.Join(root, "Videos")+sep || !reflect.DeepEqual(m, []string{"Videos"}) {
		t.Fatalf("%q %v", got, m)
	}
	if got, m = Complete(root+sep+"vid", "", false); got != filepath.Join(root, "Videos")+sep {
		t.Fatalf("case-insensitive: %q %v", got, m)
	}
	if got, m = Complete(root+sep+"zzz", "", false); got != root+sep+"zzz" || m != nil {
		t.Fatalf("no match keeps the input: %q %v", got, m)
	}
	if _, m = Complete(root+sep+".h", "", false); len(m) != 1 {
		t.Fatalf("typing a dot reveals hidden folders: %v", m)
	}
	// "~" stays "~"
	got, _ = Complete("~"+sep+"Mu", filepath.Dir(root), false)
	_ = got
	home := root
	if got, _ = Complete("~"+sep+"Mu", home, false); got != "~"+sep+"Music"+sep {
		t.Fatalf("tilde kept: %q", got)
	}
}

func TestMkdirCleansNamesAndToleratesExisting(t *testing.T) {
	root := t.TempDir()
	p, err := Mkdir(root, "  Road trip: 2026? ")
	if err != nil || filepath.Base(p) != "Road trip_ 2026_" {
		t.Fatalf("%q %v", p, err)
	}
	if st, err := os.Stat(p); err != nil || !st.IsDir() {
		t.Fatal("not created")
	}
	if again, err := Mkdir(root, "Road trip: 2026?"); err != nil || again != p {
		t.Fatalf("existing folder is fine: %q %v", again, err)
	}
	for _, bad := range []string{"", "  ", "a/b", `a\b`, ".."} {
		if _, err := Mkdir(root, bad); err == nil {
			t.Errorf("%q must be refused", bad)
		}
	}
	if entries, _ := os.ReadDir(root); len(entries) != 1 {
		t.Fatalf("nothing else may be created: %v", entries)
	}
}

func TestWritable(t *testing.T) {
	root := t.TempDir()
	if err := Writable(root); err != nil {
		t.Fatal(err)
	}
	if entries, _ := os.ReadDir(root); len(entries) != 0 {
		t.Fatal("the probe file must be removed")
	}
	if err := Writable(filepath.Join(root, "missing")); err == nil {
		t.Fatal("missing folder")
	}
	if runtime.GOOS != "windows" && os.Getuid() != 0 {
		ro := tree(t, "ro")
		p := filepath.Join(ro, "ro")
		os.Chmod(p, 0o500)
		defer os.Chmod(p, 0o700)
		if err := Writable(p); err == nil || !strings.Contains(err.Error(), "cannot write") {
			t.Fatalf("read-only folder: %v", err)
		}
	}
}

func TestShortElidesTheMiddleAndKeepsHomeReadable(t *testing.T) {
	sep := string(filepath.Separator)
	home := sep + "home" + sep + "ada"
	if got := Short(filepath.Join(home, "Videos"), home, 40); got != "~"+sep+"Videos" {
		t.Fatal(got)
	}
	if got := Short(home, home, 40); got != "~" {
		t.Fatal(got)
	}
	long := "/srv/data/very/long/path/to/some/deeply/nested/folder"
	got := Short(long, "", 24)
	if len([]rune(got)) > 24 || !strings.Contains(got, "…") || !strings.HasSuffix(got, "folder") {
		t.Fatalf("%q", got)
	}
	if Short("/a/b", "", 40) != "/a/b" {
		t.Fatal("short paths are untouched")
	}
}
