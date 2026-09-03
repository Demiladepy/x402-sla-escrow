export function Mark({ size = 28 }: { size?: number }) {
  return (
    <img
      className="mark"
      src="/mark.png"
      width={size}
      height={size}
      alt=""
      decoding="async"
    />
  );
}
