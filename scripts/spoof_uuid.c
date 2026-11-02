// Spoof hardware identity per-process via dyld interpose.
// Loaded via DYLD_INSERT_LIBRARIES; base value from env FAKE_IO_PLATFORM_UUID.
// Spoofs: IOPlatformUUID (base), IOPlatformSerialNumber + IOMACAddress (derived distinct values).
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static CFTypeRef (*real_CreateCFProperty)(io_registry_entry_t, CFStringRef, CFAllocatorRef, IOOptionBits) = NULL;
static CFTypeRef (*real_SearchCFProperty)(io_registry_entry_t, CFStringRef, CFStringRef, CFAllocatorRef, IOOptionBits) = NULL;

static const char *fake_uuid(void) {
    const char *f = getenv("FAKE_IO_PLATFORM_UUID");
    return (f && f[0]) ? f : NULL;
}

static void derive(const char *uuid, char serial[32], char mac[32]) {
    char hex[33]; int n = 0;
    for (const char *p = uuid; *p && n < 32; p++) {
        char ch = *p;
        if ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
            hex[n++] = (ch >= 'a' && ch <= 'f') ? (char)(ch - 'a' + 'A') : ch;
        }
    }
    while (n < 32) hex[n++] = '0';
    hex[32] = 0;
    snprintf(serial, 32, "SN%.12s", hex);
    snprintf(mac, 32, "02:%c%c:%c%c:%c%c:%c%c:%c%c",
             hex[22], hex[23], hex[24], hex[25], hex[26], hex[27], hex[28], hex[29], hex[30], hex[31]);
}

static CFStringRef fakeFor(CFStringRef key) {
    const char *f = fake_uuid();
    if (!f || !key) return NULL;
    char serial[32]; char mac[32];
    if (CFStringCompare(key, CFSTR("IOPlatformUUID"), 0) == kCFCompareEqualTo) {
        return CFStringCreateWithCString(kCFAllocatorDefault, f, kCFStringEncodingUTF8);
    }
    if (CFStringCompare(key, CFSTR("IOPlatformSerialNumber"), 0) == kCFCompareEqualTo) {
        derive(f, serial, mac);
        return CFStringCreateWithCString(kCFAllocatorDefault, serial, kCFStringEncodingUTF8);
    }
    if (CFStringCompare(key, CFSTR("IOMACAddress"), 0) == kCFCompareEqualTo) {
        derive(f, serial, mac);
        return CFStringCreateWithCString(kCFAllocatorDefault, mac, kCFStringEncodingUTF8);
    }
    return NULL;
}

static CFTypeRef my_CreateCFProperty(io_registry_entry_t entry, CFStringRef key, CFAllocatorRef allocator, IOOptionBits options) {
    if (!real_CreateCFProperty) real_CreateCFProperty = dlsym(RTLD_NEXT, "IORegistryEntryCreateCFProperty");
    CFStringRef sp = fakeFor(key);
    if (sp) return sp;
    return real_CreateCFProperty(entry, key, allocator, options);
}

static CFTypeRef my_SearchCFProperty(io_registry_entry_t entry, CFStringRef plane, CFStringRef key, CFAllocatorRef allocator, IOOptionBits options) {
    if (!real_SearchCFProperty) real_SearchCFProperty = dlsym(RTLD_NEXT, "IORegistryEntrySearchCFProperty");
    CFStringRef sp = fakeFor(key);
    if (sp) return sp;
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
