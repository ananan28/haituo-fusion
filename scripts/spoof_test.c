// Test helper: print IOPlatformUUID (via IOKit) and kern.uuid (via sysctl).
#include <stdio.h>
#include <IOKit/IOKitLib.h>
#include <CoreFoundation/CoreFoundation.h>
#include <sys/sysctl.h>

static void print_cf(const char *label, CFStringRef s) {
    char buf[128] = {0};
    if (s && CFStringGetCString(s, buf, sizeof(buf), kCFStringEncodingUTF8)) {
        printf("%s=%s\n", label, buf);
    } else {
        printf("%s=(null)\n", label);
    }
}

int main(void) {
    io_service_t s = IOServiceGetMatchingService(kIOMasterPortDefault, IOServiceMatching("IOPlatformExpertDevice"));
    CFStringRef u = IORegistryEntryCreateCFProperty(s, CFSTR("IOPlatformUUID"), kCFAllocatorDefault, 0);
    CFStringRef sn = IORegistryEntryCreateCFProperty(s, CFSTR("IOPlatformSerialNumber"), kCFAllocatorDefault, 0);
    char kb[128] = {0};
    size_t len = sizeof(kb);
    sysctlbyname("kern.uuid", kb, &len, NULL, 0);
    print_cf("IOPlatformUUID", u);
    print_cf("IOPlatformSerialNumber", sn);
    printf("kern.uuid=%s\n", kb);
    return 0;
}
