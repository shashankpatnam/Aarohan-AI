import mongoose from "mongoose";

export const STAFF_ROLES = ["admin", "staff"];

const INITIAL_ADMIN_BOOTSTRAP_SLOT = 1;

const staffUserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: STAFF_ROLES,
      required: true,
      default: "staff",
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
    tokenVersion: {
      type: Number,
      required: true,
      default: 0,
    },
    /**
     * Only the first admin created via one-time setup sets this to 1.
     * Sparse unique index prevents concurrent setup from creating multiple
     * bootstrap admins while still allowing additional admins later.
     */
    bootstrapSlot: {
      type: Number,
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

staffUserSchema.index(
  { bootstrapSlot: 1 },
  {
    unique: true,
    sparse: true,
  },
);

const StaffUser = mongoose.model("StaffUser", staffUserSchema);

export { INITIAL_ADMIN_BOOTSTRAP_SLOT };
export default StaffUser;
