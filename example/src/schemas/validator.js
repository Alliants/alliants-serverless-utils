import JoiDate from '@joi/date'
import JoiBase from 'joi'

/** @type { import("joi").Root } */
const Joi = JoiBase.extend(JoiDate)

export { Joi }
