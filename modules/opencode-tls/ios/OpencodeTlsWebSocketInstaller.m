#import "OpencodeTlsWebSocketInstaller.h"
#import "OpencodeTlsSecurityPolicy.h"
#import "OpencodeTlsTrust.h"
#import <SocketRocket/SRWebSocket.h>
#import <dlfcn.h>

@implementation OpencodeTlsWebSocketInstaller

+ (void)install {
  typedef SRWebSocket *_Nullable (^Provider)(NSURLRequest *);
  typedef void (*Setter)(Provider _Nullable);
  Setter setter = (Setter)dlsym(RTLD_DEFAULT, "RCTSetCustomSRWebSocketProvider");
  if (!setter) {
    return;
  }
  Provider provider = ^SRWebSocket *_Nullable(NSURLRequest *request) {
    NSURL *url = request.URL;
    NSString *host = url.host;
    if (host.length == 0) {
      return nil;
    }
    NSNumber *portNumber = url.port;
    NSInteger port = portNumber ? portNumber.integerValue : 443;
    NSString *origin = [OpencodeTlsTrust originKeyForHost:host port:port];
    NSArray *certificates = [OpencodeTlsTrust certificatesForOrigin:origin];
    if (certificates.count == 0) {
      return nil;
    }
    OpencodeTlsSecurityPolicy *policy =
        [[OpencodeTlsSecurityPolicy alloc] initWithOrigin:origin certificates:certificates];
    NSString *protocolsHeader = [request valueForHTTPHeaderField:@"Sec-WebSocket-Protocol"];
    NSArray<NSString *> *protocols = nil;
    if (protocolsHeader.length > 0) {
      NSMutableArray<NSString *> *parts = [NSMutableArray array];
      for (NSString *part in [protocolsHeader componentsSeparatedByString:@","]) {
        NSString *trimmed =
            [part stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
        if (trimmed.length > 0) {
          [parts addObject:trimmed];
        }
      }
      protocols = parts;
    }
    return [[SRWebSocket alloc] initWithURLRequest:request
                                         protocols:protocols
                                    securityPolicy:policy];
  };
  setter(provider);
}

@end
