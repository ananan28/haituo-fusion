// Spoof IOPlatformUUID / IOPlatformSerialNumber / kern.uuid per-process.
// Loaded via DYLD_INSERT_LIBRARIES; fake value from env FAKE_IO_PLATFORM_UUID.
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/sysctl.h>

static CFTypeRef (*real_CreateCFProperty)(io_registry_entry_t, CFStringRef, CFAllocatorRef, IOOptionBits) = NULL;
static CFTypeRef (*real_SearchCFProperty)(io_registry_entry_t, CFStringRef, CFStringRef, CFAllocatorRef, IOOptionBits) = NULL;
static int (*real_sysctlbyname)(const char *, void *, size_t *, void *, size_t) = NULL;

static const char *fake_uuid(void) {
    const char *f = getenv("FAKE_IO_PLATFORM_UUID");
    return (f && f[0]) ? f : NULL;
}

static CFTypeRef my_CreateCFProperty(io_registry_entry_t entry, CFStringRef key, CFAllocatorRef allocator, IOOptionBits options) {
    if (!real_CreateCFProperty) real_CreateCFProperty = dlsym(RTLD_NEXT, "IORegistryEntryCreateCFProperty");
    const char *f = fake_uuid();
    if (f && key && (CFStringCompare(key, CFSTR("IOPlatformUUID"), 0) == kCFCompareEqualTo ||
                     CFStringCompare(key, CFSTR("IOPlatformSerialNumber"), 0) == kCFCompareEqualTo)) {
        return CFStringCreateWithCString(kCFAllocatorDefault, f, kCFStringEncodingUTF8);
    }
    return real_CreateCFProperty(entry, key, allocator, options);
}

static CFTypeRef my_SearchCFProperty(io_registry_entry_t entry, CFStringRef plane, CFStringRef key, CFAllocatorRef allocator, IOOptionBits options) {
    if (!real_SearchCFProperty) real_SearchCFProperty = dlsym(RTLD_NEXT, "IORegistryEntrySearchCFProperty");
    const char *f = fake_uuid();
    if (f && key && CFStringCompare(key, CFSTR("IOPlatformUUID"), 0) == kCFCompareEqualTo) {
        return CFStringCreateWithCString(kCFAllocatorDefault, f, kCFStringEncodingUTF8);
    }
    return real_SearchCFProperty(entry, plane, key, allocator, options);
}

static int my_sysctlbyname(const char *name, void *oldp, size_t *oldlenp, void *newp, size_t newlen) {
    if (!real_sysctlbyname) real_sysctlbyname = dlsym(RTLD_NEXT, "sysctlbyname");
    const char *f = fake_uuid();
    if (f && name && strcmp(name, "kern.uuid") == 0 && oldp && oldlenp) {
        size_t need = strlen(f) + 1;
        if (*oldlenp >= need) {
            memcpy(oldp, f, need);
            *oldlenp = need;
            return 0;
        }
        *oldlenp = need;
        return -1;
    }
    return real_sysctlbyname(name, oldp, oldlenp, newp, newlen);
}

__attribute__((constructor)) static void init(void) {
    const char *f = fake_uuid();
    FILE *log = fopen("/tmp/spoof_uuid.log", "a");
    if (log) { fprintf(log, "spoof_uuid loaded pid=%d fake=%s\n", getpid(), f ? f : "(none)"); fclose(log); }
}

typedef struct { const void *replacement; const void *replacee; } interpose_t;

static const interpose_t interposers[] __attribute__((used, section("__DATA,__interpose"))) = {
    { (const void *)my_CreateCFProperty, (const void *)IORegistryEntryCreateCFProperty },
    { (const void *)my_SearchCFProperty, (const void *)IORegistryEntrySearchCFProperty },
    { (const void *)my_sysctlbyname, (const void *)sysctlbyname },
};
