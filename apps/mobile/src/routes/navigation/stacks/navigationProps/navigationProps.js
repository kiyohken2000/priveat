import { StyleSheet } from 'react-native'
import { colors } from '../../../../theme'

// ステータスバーが dark-content（黒文字）なので、ヘッダー背景は明るい色を使う。
// 細いボトムボーダーで本文との境界を出す。
const navigationProps = {
  headerTintColor: colors.darkPurple,
  headerStyle: {
    backgroundColor: colors.white,
    elevation: 0,
    shadowOpacity: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e2f0',
  },
  headerTitleStyle: {
    fontSize: 18,
    color: colors.darkPurple,
    fontWeight: '700',
  },
  headerMode: 'float',
}

export { navigationProps }
