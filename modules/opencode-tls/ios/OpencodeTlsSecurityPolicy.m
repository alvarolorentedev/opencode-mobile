#import "OpencodeTlsSecurityPolicy.h"
#import "OpencodeTlsTrust.h"

@implementation OpencodeTlsSecurityPolicy {
  NSString *_origin;
  NSArray *_certificates;
}

- (instancetype)initWithOrigin:(NSString *)origin certificates:(NSArray *)certificates {
  self = [super init];
  if (self) {
    _origin = [origin copy];
    _certificates = [certificates copy];
  }
  return self;
}

- (void)updateSecurityOptionsInStream:(NSStream *)stream {
  // Enforce TLS 1.2 with the same value the default SRSecurityPolicy uses.
  // There is no kCFStreamSocketSecurityLevel* C symbol for it, only this string.
  [stream setProperty:(__bridge id)CFSTR("kCFStreamSocketSecurityLevelTLSv1_2")
               forKey:(__bridge id)kCFStreamPropertySocketSecurityLevel];
  NSDictionary *options = @{(id)kCFStreamSSLValidatesCertificateChain: @NO};
  [stream setProperty:options
               forKey:(__bridge NSString *)kCFStreamPropertySSLSettings];
}

- (BOOL)evaluateServerTrust:(SecTrustRef)serverTrust forDomain:(NSString *)domain {
  return [OpencodeTlsTrust evaluateTrust:serverTrust host:domain certificates:_certificates];
}

@end
