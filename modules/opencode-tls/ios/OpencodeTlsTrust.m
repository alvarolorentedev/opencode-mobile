#import "OpencodeTlsTrust.h"

static NSMutableDictionary<NSString *, NSArray *> *Anchors(void) {
  static NSMutableDictionary<NSString *, NSArray *> *anchors;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    anchors = [NSMutableDictionary dictionary];
  });
  return anchors;
}

static NSObject *AnchorsLock(void) {
  static NSObject *lock;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    lock = [NSObject new];
  });
  return lock;
}

@implementation OpencodeTlsTrust

+ (NSString *)originKeyForHost:(NSString *)host port:(NSInteger)port {
  NSString *normalized = host;
  if ([host rangeOfString:@":"].location != NSNotFound && ![host hasPrefix:@"["]) {
    normalized = [NSString stringWithFormat:@"[%@]", host];
  }
  return [NSString stringWithFormat:@"%@:%ld", normalized, (long)port];
}

+ (void)setAnchors:(NSArray *)certificates forOrigin:(NSString *)origin {
  @synchronized (AnchorsLock()) {
    Anchors()[origin] = [certificates copy];
  }
}

+ (void)clearAnchorsForOrigin:(NSString *)origin {
  @synchronized (AnchorsLock()) {
    [Anchors() removeObjectForKey:origin];
  }
}

+ (NSArray *)certificatesForOrigin:(NSString *)origin {
  @synchronized (AnchorsLock()) {
    NSArray *certificates = Anchors()[origin];
    return certificates ?: @[];
  }
}

+ (BOOL)evaluateTrust:(SecTrustRef)trust host:(NSString *)host certificates:(NSArray *)certificates {
  SecPolicyRef policy = SecPolicyCreateSSL(true, (__bridge CFStringRef)host);
  SecTrustSetPolicies(trust, (__bridge CFArrayRef)@[(__bridge id)policy]);
  CFRelease(policy);
  if (certificates.count > 0) {
    SecTrustSetAnchorCertificates(trust, (__bridge CFArrayRef)certificates);
    SecTrustSetAnchorCertificatesOnly(trust, false);
  }
  CFErrorRef error = NULL;
  return SecTrustEvaluateWithError(trust, &error);
}

@end
