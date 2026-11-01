#import <Foundation/Foundation.h>
#import <Security/Security.h>

NS_ASSUME_NONNULL_BEGIN

/// Objective-C anchor store for the WebSocket trust path.
///
/// Mirrors `TrustStore` in Swift, which serves the URLSession-based paths
/// (`OpencodeTlsURLProtocol`, `TlsProbe`). The two stores hold the same
/// anchors: every write flows through `OpencodeTlsModule`'s
/// `setTrustAnchors`/`clearTrustAnchors`, which update both. They are kept
/// separate (instead of sharing one store) so the Objective-C files never
/// import the generated Swift header, which is unavailable when CocoaPods
/// compiles this target.
@interface OpencodeTlsTrust : NSObject

+ (NSString *)originKeyForHost:(NSString *)host port:(NSInteger)port;
+ (void)setAnchors:(NSArray *)certificates forOrigin:(NSString *)origin;
+ (void)clearAnchorsForOrigin:(NSString *)origin;
+ (NSArray *)certificatesForOrigin:(NSString *)origin;
+ (BOOL)evaluateTrust:(SecTrustRef)trust host:(NSString *)host certificates:(NSArray *)certificates;

@end

NS_ASSUME_NONNULL_END
