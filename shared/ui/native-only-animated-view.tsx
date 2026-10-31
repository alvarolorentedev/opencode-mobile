// Source: founded-labs/react-native-reusables @ 385834c2196f8a303cbc9057d1ac768f3bde0a3b (Uniwind, MIT).
import { Platform, Pressable } from 'react-native';
import Animated from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * This component is used to wrap animated views that should only be animated on native.
 * @param props - The props for the animated view.
 * @returns The animated view if the platform is native, otherwise the children.
 * @example
 * <NativeOnlyAnimatedView entering={FadeIn} exiting={FadeOut}>
 *   <Text>I am only animated on native</Text>
 * </NativeOnlyAnimatedView>
 */
function NativeOnlyAnimatedView(
  props: (React.ComponentProps<typeof Animated.View> & React.RefAttributes<typeof Animated.View>
    & { as?: "View" }) | (React.ComponentProps<typeof AnimatedPressable> & React.RefAttributes<typeof AnimatedPressable> & { as: "Pressable" })
) {
  if (Platform.OS === 'web') {
    return <>{props.children as React.ReactNode}</>;
  } else {
    if (props.as === "Pressable"){
      return <AnimatedPressable {...props} />;
    }
    return <Animated.View {...props} />;
  }
}

export { NativeOnlyAnimatedView };
