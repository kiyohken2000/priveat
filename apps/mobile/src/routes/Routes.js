import React, { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { authenticate } from 'slices/app.slice'
import Main from './navigation'
import Loading from '../scenes/loading/Loading'

export default function Routes() {
  const dispatch = useDispatch()
  const { checked } = useSelector((state) => state.app)

  useEffect(() => {
    dispatch(authenticate({ checked: true }))
  }, [dispatch])

  if (!checked) {
    return <Loading />
  }

  return <Main />
}
