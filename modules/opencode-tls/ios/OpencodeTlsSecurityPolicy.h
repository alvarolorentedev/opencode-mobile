#import <SocketRocket/SRSecurityPolicy.h>

NS_ASSUME_NONNULL_BEGIN

@interface OpencodeTlsSecurityPolicy : SRSecurityPolicy

- (instancetype)initWithOrigin:(NSString *)origin certificates:(NSArray *)certificates;

@end

NS_ASSUME_NONNULL_END
