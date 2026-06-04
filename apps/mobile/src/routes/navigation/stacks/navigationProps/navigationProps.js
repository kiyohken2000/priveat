import { colors } from '../../../../theme'

const headerTintColor = colors.white
const fontSize = 18
const headerMode = 'float'

const navigationProps = {
  headerTintColor,
  headerStyle: {
    backgroundColor: colors.darkPurple,
  },
  headerTitleStyle: { fontSize },
  headerMode,
}

export { navigationProps }
