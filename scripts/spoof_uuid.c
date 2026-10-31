// Spoof IOPlatformUUID / IOPlatformSerialNumber per-process via dyld interpose.
// Loaded via DYLD_INSERT_LIBRARIES; fake value from env FAKE_IO_PLATFORM_UUID.
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>

static CFTypeRef (*real_CreateCFProperty)(io_registry_entry_t, CFStringRef, CFAllocatorRef, IOOptionBits) = NULL;
static CFTypeRef (*real_SearchCFProperty)(io_registry_entry_t, CFStringRef, CFStringRef, CFAllocatorRef, IOOptionBits) = NULL;

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

__attribute__((constructor)) static void init(void) {
    const char *f = fake_uuid();
    FILE *log = fopen("/tmp/spoof_uuid.log", "a");
    if (log) { fprintf(log, "spoof_uuid loaded pid=%d fake=%s\n", getpid(), f ? f : "(none)"); fclose(log); }
}

typedef struct { const void *replacement; const void *replacee; } interpose_t;

static const interpose_t interposers[] __attribute__((used, section("__DATA,__interpose"))) = {
    { (const void *)my_CreateCFProperty, (const void *)IORegistryEntryCreateCFProperty },
    { (const void *)my_SearchCFProperty, (const void *)IORegistryEntrySearchCFProperty },
};
