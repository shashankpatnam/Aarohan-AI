export default function ProjectLabel({ project, label, className = "" }) {
  const text = label || project || "General Inquiry";
  const isGeneralInquiry = text === "General Inquiry";

  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-xs font-medium ${
        isGeneralInquiry
          ? "bg-[#F1F5F2] text-[#42634F] ring-1 ring-inset ring-[#527A65]/15"
          : "text-gray-700"
      } ${className}`}
    >
      {text}
    </span>
  );
}
